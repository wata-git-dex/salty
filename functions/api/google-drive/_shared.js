import { json, requireSodiumMember } from '../stream/_shared.js';

const SUPABASE_URL = 'https://maihhnwrstewzapsvrec.supabase.co';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SERVICE_ACCOUNT_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
let cachedServiceToken = null;

function requireEnv(env, names) {
  const missing = names.filter(name => !env[name]);
  if (missing.length) throw new Response('Google Drive is not configured yet', { status:503 });
}

function bytesToBase64Url(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function stringToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function serviceAccountConfig(env) {
  requireEnv(env, ['GOOGLE_SERVICE_ACCOUNT_JSON']);
  let config;
  try { config = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON); }
  catch (_error) { throw new Response('Sodium Drive counting is not configured correctly', { status:503 }); }
  if (!config.client_email || !config.private_key) {
    throw new Response('Sodium Drive counting is not configured correctly', { status:503 });
  }
  return config;
}

function privateKeyBytes(pem) {
  const value = String(pem || '')
    .replace(/-----BEGIN PRIVATE KEY-----/gu, '')
    .replace(/-----END PRIVATE KEY-----/gu, '')
    .replace(/\s/gu, '');
  if (!value) throw new Response('Sodium Drive counting is not configured correctly', { status:503 });
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function googleServiceAccountEmail(env) {
  return serviceAccountConfig(env).client_email;
}

export async function googleServiceAccountAccessToken(env) {
  if (cachedServiceToken?.expiresAt > Date.now() + 60_000) return cachedServiceToken.value;
  const config = serviceAccountConfig(env);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${stringToBase64Url(JSON.stringify({ alg:'RS256', typ:'JWT' }))}.${stringToBase64Url(JSON.stringify({
    iss:config.client_email,
    scope:SERVICE_ACCOUNT_SCOPE,
    aud:GOOGLE_TOKEN_URL,
    iat:now,
    exp:now + 3600,
  }))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes(config.private_key),
    { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:`${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    console.error('Google service token failed:', response.status, payload.error || 'unknown');
    throw new Response('Sodium could not start Drive counting', { status:502 });
  }
  cachedServiceToken = { value:payload.access_token, expiresAt:Date.now() + Number(payload.expires_in || 3600) * 1000 };
  return cachedServiceToken.value;
}

export async function countDriveVideoFiles(accessToken, folderId) {
  let pageToken = '';
  let total = 0;
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,mimeType)');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers:{ Authorization:`Bearer ${accessToken}` } });
    const payload = await response.json();
    if (!response.ok) {
      const unavailable = response.status === 403 || response.status === 404;
      throw new Response(unavailable
        ? 'Share this Google Drive folder with Sodium as a Viewer, then retry.'
        : 'Could not count the Google Drive clips', { status:unavailable ? 409 : 502 });
    }
    total += (payload.files || []).filter(file => String(file.mimeType || '').startsWith('video/')).length;
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return Math.min(2000, total);
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
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

export async function requireMember(request) {
  return requireSodiumMember(request);
}

export { json };
