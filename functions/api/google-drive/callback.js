import { authorizeSelectedFolder, encryptRefreshToken, exchangeAuthorizationCode, getDriveConnection, saveDriveConnection, verifyOAuthState } from './_shared.js';

function appRedirect(request, status, native = false, folder = null) {
  const url = native ? new URL('sodium://drive') : new URL('/', request.url);
  url.searchParams.set('drive', status);
  if (folder) {
    url.searchParams.set('folder', folder.id);
    url.searchParams.set('name', folder.name);
    url.searchParams.set('url', folder.url);
  }
  return Response.redirect(url.href, 302);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let state = null;
  try {
    state = await verifyOAuthState(env, url.searchParams.get('state'));
    if (url.searchParams.get('error')) return appRedirect(request, 'cancelled', state.native);
    const code = url.searchParams.get('code');
    if (!code) return appRedirect(request, 'error', state.native);
    const tokens = await exchangeAuthorizationCode(env, request, code);
    const current = await getDriveConnection(env, state.sub);
    const encryptedRefreshToken = tokens.refresh_token
      ? await encryptRefreshToken(env, tokens.refresh_token)
      : current?.encrypted_refresh_token;
    if (!encryptedRefreshToken) return appRedirect(request, 'error', state.native);
    await saveDriveConnection(env, state.sub, encryptedRefreshToken, current?.google_email || null);
    const pickedFolderId = url.searchParams.get('picked_file_ids')?.split(',').map(value => value.trim()).find(Boolean) || '';
    if (state.pick && !pickedFolderId) return appRedirect(request, 'cancelled', state.native);
    const folder = pickedFolderId ? await authorizeSelectedFolder(env, state.sub, pickedFolderId) : null;
    return appRedirect(request, folder ? 'selected' : 'connected', state.native, folder);
  } catch (error) {
    console.error('Google Drive callback failed:', error);
    return appRedirect(request, 'error', Boolean(state?.native));
  }
}
