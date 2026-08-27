import { getDriveConnection, json, refreshGoogleAccessToken, requireLiveFolderCountConnection, requireMember } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireMember(request);
    const connection = await getDriveConnection(env, user.id);
    requireLiveFolderCountConnection(connection);
    const accessToken = await refreshGoogleAccessToken(env, connection.encrypted_refresh_token);
    if (!env.GOOGLE_PICKER_API_KEY || !env.GOOGLE_APP_ID) return json({ error:'Google Picker is not configured yet.' }, 503);
    return json({ connected:true, accessToken, apiKey:env.GOOGLE_PICKER_API_KEY, appId:env.GOOGLE_APP_ID });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not open Google Drive.' }, 500);
  }
}
