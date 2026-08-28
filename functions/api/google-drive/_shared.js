import { json, requireSodiumMember } from '../stream/_shared.js';

const SUPABASE_URL = 'https://maihhnwrstewzapsvrec.supabase.co';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
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

export async function createOAuthState(env, userId, options = {}) {
  requireEnv(env, ['GOOGLE_OAUTH_STATE_SECRET']);
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    sub:userId,
    native:Boolean(options.native),
    pick:Boolean(options.pick),
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

export function googleAuthorizationUrl(env, request, state, options = {}) {
  requireEnv(env, ['GOOGLE_CLIENT_ID']);
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id:env.GOOGLE_CLIENT_ID,
    redirect_uri:googleRedirectUri(request),
    response_type:'code',
    scope:DRIVE_FILE_SCOPE,
    access_type:'offline',
    prompt:'consent',
    // Do not re-request previously granted restricted scopes. Sodium needs
    // access only to folders the member explicitly chooses in Picker.
    include_granted_scopes:'false',
    state,
  }).toString();
  if (options.pick) {
    // Google Picker's supported desktop/mobile flow combines consent and
    // folder selection in the system browser. This avoids embedding Google's
    // account page inside the Capacitor WebView, where third-party cookie
    // protections can make an otherwise valid account appear inaccessible.
    url.searchParams.set('trigger_onepick', 'true');
    url.searchParams.set('allow_folder_selection', 'true');
    url.searchParams.set('allow_multiple', 'false');
    url.searchParams.set('mimetypes', 'application/vnd.google-apps.folder');
  }
  return url.href;
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
  if (!response.ok || !payload.access_token) throw new Response('Google did not complete the Drive connection', { status:502 });
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

export async function authorizeSelectedFolder(env, userId, folderId) {
  const connection = await getDriveConnection(env, userId);
  if (!connection) throw new Response('Connect Google Drive in Sodium first', { status:409 });
  const accessToken = await refreshGoogleAccessToken(env, connection.encrypted_refresh_token);
  const metadataResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,webViewLink`, {
    headers:{ Authorization:`Bearer ${accessToken}` },
  });
  const folder = await metadataResponse.json();
  if (!metadataResponse.ok || folder.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Response('Choose a Google Drive folder, not an individual file', { status:400 });
  }
  const sharingEmail = googleServiceAccountEmail(env);
  const permissionsResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}/permissions?fields=permissions(id,emailAddress,role)&supportsAllDrives=true`, {
    headers:{ Authorization:`Bearer ${accessToken}` },
  });
  const permissionsPayload = await permissionsResponse.json().catch(() => ({}));
  if (!permissionsResponse.ok) throw new Response('Sodium could not check access to that folder', { status:502 });
  const alreadyShared = (permissionsPayload.permissions || []).some(permission =>
    permission.emailAddress?.toLowerCase() === sharingEmail.toLowerCase() && ['reader', 'commenter', 'writer', 'owner'].includes(permission.role));
  if (!alreadyShared) {
    const permissionResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
      method:'POST',
      headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ type:'user', role:'reader', emailAddress:sharingEmail }),
    });
    if (!permissionResponse.ok) {
      const detail = await permissionResponse.json().catch(() => ({}));
      console.error('Drive folder permission failed:', permissionResponse.status, detail.error?.message || 'unknown');
      throw new Response('Sodium could not enable live counting for that folder', { status:502 });
    }
  }
  return {
    id:folder.id,
    name:folder.name || 'Google Drive folder',
    url:folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
    sharingEmail,
  };
}

export async function requireMember(request) {
  return requireSodiumMember(request);
}

export { json };
