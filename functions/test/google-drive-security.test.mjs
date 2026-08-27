import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOAuthState,
  decryptRefreshToken,
  encryptRefreshToken,
  googleAuthorizationUrl,
  verifyOAuthState,
} from '../api/google-drive/_shared.js';

const env = {
  GOOGLE_OAUTH_STATE_SECRET:'test-only-state-secret-with-enough-entropy',
  GOOGLE_TOKEN_ENCRYPTION_KEY:'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
};

test('OAuth state is signed, bound to the member, and tamper evident', async () => {
  const state = await createOAuthState(env, '11111111-1111-4111-8111-111111111111');
  const verified = await verifyOAuthState(env, state);
  assert.equal(verified.sub, '11111111-1111-4111-8111-111111111111');
  await assert.rejects(() => verifyOAuthState(env, `${state.slice(0, -1)}x`));
});

test('Google refresh tokens are encrypted at rest', async () => {
  const encrypted = await encryptRefreshToken(env, 'refresh-token-that-never-enters-the-client');
  assert.match(encrypted, /^v1\./u);
  assert.ok(!encrypted.includes('refresh-token'));
  assert.equal(await decryptRefreshToken(env, encrypted), 'refresh-token-that-never-enters-the-client');
});

test('Drive authorization can count ordinary files added outside Sodium', () => {
  const url = new URL(googleAuthorizationUrl(
    { GOOGLE_CLIENT_ID:'test-client' },
    new Request('https://community.saltyviewfinder.com/api/google-drive/connect'),
    'signed-state',
  ));
  const scopes = new Set((url.searchParams.get('scope') || '').split(' '));
  assert.ok(scopes.has('https://www.googleapis.com/auth/drive.file'));
  assert.ok(scopes.has('https://www.googleapis.com/auth/drive.metadata.readonly'));
});
