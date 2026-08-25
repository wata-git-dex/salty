import { encryptRefreshToken, exchangeAuthorizationCode, getDriveConnection, saveDriveConnection, verifyOAuthState } from './_shared.js';

function appRedirect(request, status) {
  const url = new URL('/', request.url);
  url.searchParams.set('drive', status);
  return Response.redirect(url.href, 302);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  try {
    if (url.searchParams.get('error')) return appRedirect(request, 'cancelled');
    const state = await verifyOAuthState(env, url.searchParams.get('state'));
    const code = url.searchParams.get('code');
    if (!code) return appRedirect(request, 'error');
    const tokens = await exchangeAuthorizationCode(env, request, code);
    const current = await getDriveConnection(env, state.sub);
    const encryptedRefreshToken = tokens.refresh_token
      ? await encryptRefreshToken(env, tokens.refresh_token)
      : current?.encrypted_refresh_token;
    if (!encryptedRefreshToken) return appRedirect(request, 'error');
    await saveDriveConnection(env, state.sub, encryptedRefreshToken, current?.google_email || null);
    return appRedirect(request, 'connected');
  } catch (_error) {
    return appRedirect(request, 'error');
  }
}
