import { json, requireSodiumMember } from '../stream/_shared.js';

const SUPABASE_URL = 'https://maihhnwrstewzapsvrec.supabase.co';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function requireEnv(env, names) {
  const missing = names.filter(name => !env[name]);
  if (missing.length) throw new Response('Google Drive is not configured yet', { status:503 });
}

function bytesToBase64Url(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function createOAuthState(env, userId) {
  requireEnv(env, ['GOOGLE_OAUTH_STATE_SECRET']);
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    sub:userId,
    exp:Date.now() + 10 * 60 * 1000,
    nonce:bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18))),
  })));
  const signature = bytesToBase64Url(await hmac(env.GOOGLE_OAUTH_STATE_SECRET, payload));
  return `${payload}.${signature}`;
}

export async function verifyOAuthState(env, state) {
  requireEnv(env, ['GOOGLE_OAUTH_STATE_SECRET']);
  const [payload, signature, extra] = String(state || '').split('.');
  if (!payload || !signature || extra) throw new Response('Invalid Google authorization state', { status:400 });
  const expected = await hmac(env.GOOGLE_OAUTH_STATE_SECRET, payload);
  const received = base64UrlToBytes(signature);
  if (!constantTimeEqual(expected, received)) throw new Response('Invalid Google authorization state', { status:400 });
  let decoded;
  try { decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))); }
  catch (_error) { throw new Response('Invalid Google authorization state', { status:400 }); }
  if (!decoded.sub || !Number.isFinite(decoded.exp) || decoded.exp < Date.now()) {
    throw new Response('Google authorization expired. Return to Sodium and try again.', { status:400 });
  }
  return decoded;
}

function encryptionKeyBytes(env) {
  requireEnv(env, ['GOOGLE_TOKEN_ENCRYPTION_KEY']);
  const bytes = base64UrlToBytes(env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  if (bytes.length !== 32) throw new Response('Google Drive encryption is not configured correctly', { status:503 });
  return bytes;
}

export async function encryptRefreshToken(env, refreshToken) {
  const key = await crypto.subtle.importKey('raw', encryptionKeyBytes(env), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(refreshToken)));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
}

export async function decryptRefreshToken(env, encrypted) {
  const [version, ivValue, ciphertextValue, extra] = String(encrypted || '').split('.');
  if (version !== 'v1' || !ivValue || !ciphertextValue || extra) throw new Response('Reconnect Google Drive in Sodium', { status:409 });
  try {
    const key = await crypto.subtle.importKey('raw', encryptionKeyBytes(env), 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name:'AES-GCM', iv:base64UrlToBytes(ivValue) }, key, base64UrlToBytes(ciphertextValue));
    return new TextDecoder().decode(plaintext);
  } catch (_error) {
    throw new Response('Reconnect Google Drive in Sodium', { status:409 });
  }
}

export function googleRedirectUri(request) {
  const url = new URL(request.url);
  return `${url.origin}/api/google-drive/callback`;
}

export async function exchangeAuthorizationCode(env, request, code) {
  requireEnv(env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams({
      code,
      client_id:env.GOOGLE_CLIENT_ID,
      client_secret:env.GOOGLE_CLIENT_SECRET,
      redirect_uri:googleRedirectUri(request),
      grant_type:'authorization_code',
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Response('Google did not complete the connection', { status:502 });
  return payload;
}

export async function refreshGoogleAccessToken(env, encryptedRefreshToken) {
  requireEnv(env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  const refreshToken = await decryptRefreshToken(env, encryptedRefreshToken);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams({
      refresh_token:refreshToken,
      client_id:env.GOOGLE_CLIENT_ID,
      client_secret:env.GOOGLE_CLIENT_SECRET,
      grant_type:'refresh_token',
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Response('Reconnect Google Drive in Sodium', { status:409 });
  return payload.access_token;
}

export function googleAuthorizationUrl(env, request, state) {
  requireEnv(env, ['GOOGLE_CLIENT_ID']);
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id:env.GOOGLE_CLIENT_ID,
    redirect_uri:googleRedirectUri(request),
    response_type:'code',
    scope:DRIVE_SCOPE,
    access_type:'offline',
    prompt:'consent',
    include_granted_scopes:'true',
    state,
  }).toString();
  return url.href;
}

export async function serviceRequest(env, path, init = {}) {
  requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY']);
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers:{
      apikey:env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

export async function getDriveConnection(env, userId) {
  const response = await serviceRequest(env, `google_drive_connections?user_id=eq.${encodeURIComponent(userId)}&select=user_id,google_email,encrypted_refresh_token,updated_at&limit=1`);
  if (!response.ok) throw new Response('Could not read the Google Drive connection', { status:502 });
  const rows = await response.json();
  return rows[0] || null;
}

export async function saveDriveConnection(env, userId, encryptedRefreshToken, googleEmail = null) {
  const response = await serviceRequest(env, 'google_drive_connections?on_conflict=user_id', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' },
    body:JSON.stringify({ user_id:userId, encrypted_refresh_token:encryptedRefreshToken, google_email:googleEmail, updated_at:new Date().toISOString() }),
  });
  if (!response.ok) throw new Response('Could not save the Google Drive connection', { status:502 });
}

export async function requireMember(request) {
  return requireSodiumMember(request);
}

export { json };
