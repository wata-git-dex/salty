import { getDriveConnection, json, refreshGoogleAccessToken, requireMember } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireMember(request);
    const connection = await getDriveConnection(env, user.id);
    if (!connection) return json({ connected:false }, 409);
    const accessToken = await refreshGoogleAccessToken(env, connection.encrypted_refresh_token);
    const appId = env.GOOGLE_APP_ID || String(env.GOOGLE_CLIENT_ID || '').split('-')[0];
    if (!env.GOOGLE_PICKER_API_KEY || !appId) return json({ error:'Google Picker is not configured yet.' }, 503);
    return json({ connected:true, accessToken, apiKey:env.GOOGLE_PICKER_API_KEY, appId });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not open Google Drive.' }, 500);
  }
}
