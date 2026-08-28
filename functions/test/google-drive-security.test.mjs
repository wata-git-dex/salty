import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countDriveVideoFiles,
  createOAuthState,
  decryptRefreshToken,
  encryptRefreshToken,
  googleAuthorizationUrl,
  googleServiceAccountAccessToken,
  googleServiceAccountEmail,
  verifyOAuthState,
} from '../api/google-drive/_shared.js';

const env = {
  GOOGLE_CLIENT_ID:'123456789012-example.apps.googleusercontent.com',
  GOOGLE_OAUTH_STATE_SECRET:'test-only-state-secret-with-enough-entropy',
  GOOGLE_TOKEN_ENCRYPTION_KEY:'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
};

test('Drive authorization uses only the chosen-file scope and preserves native picker state', async () => {
  const state = await createOAuthState(env, 'user-123', { native:true, pick:true });
  const verified = await verifyOAuthState(env, state);
  assert.equal(verified.sub, 'user-123');
  assert.equal(verified.native, true);
  assert.equal(verified.pick, true);

  const authorization = new URL(googleAuthorizationUrl(
    env,
    new Request('https://community.saltyviewfinder.com/api/google-drive/connect'),
    state,
    { pick:true },
  ));
  assert.equal(authorization.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(authorization.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(authorization.searchParams.get('trigger_onepick'), 'true');
  assert.equal(authorization.searchParams.get('allow_folder_selection'), 'true');
  assert.equal(authorization.searchParams.get('redirect_uri'), 'https://community.saltyviewfinder.com/api/google-drive/callback');
});

test('Google refresh tokens are encrypted at rest', async () => {
  const encrypted = await encryptRefreshToken(env, 'refresh-token-that-never-enters-the-client');
  assert.match(encrypted, /^v1\./u);
  assert.ok(!encrypted.includes('refresh-token'));
  assert.equal(await decryptRefreshToken(env, encrypted), 'refresh-token-that-never-enters-the-client');
});

test('free folder counting uses a Sodium service identity without member OAuth', async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name:'RSASSA-PKCS1-v1_5', modulusLength:2048, publicExponent:new Uint8Array([1, 0, 1]), hash:'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----\n`;
  const serviceEnv = { GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({ client_email:'sodium-drive@test-project.iam.gserviceaccount.com', private_key:privateKey }) };
  assert.equal(googleServiceAccountEmail(serviceEnv), 'sodium-drive@test-project.iam.gserviceaccount.com');
  const originalFetch = globalThis.fetch;
  let assertion = '';
  globalThis.fetch = async (_url, init) => {
    assertion = new URLSearchParams(init.body).get('assertion') || '';
    return new Response(JSON.stringify({ access_token:'service-token', expires_in:3600 }), { status:200, headers:{ 'Content-Type':'application/json' } });
  };
  try {
    assert.equal(await googleServiceAccountAccessToken(serviceEnv), 'service-token');
    assert.equal(assertion.split('.').length, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test('shared-folder counting includes videos and ignores other files', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ files:[
    { id:'video-1', mimeType:'video/mp4' },
    { id:'image-1', mimeType:'image/jpeg' },
    { id:'video-2', mimeType:'video/quicktime' },
  ] }), { status:200, headers:{ 'Content-Type':'application/json' } });
  try { assert.equal(await countDriveVideoFiles('service-token', 'folder_1234567890'), 2); }
  finally { globalThis.fetch = originalFetch; }
});
