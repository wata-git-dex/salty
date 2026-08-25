import { decryptRefreshToken, getDriveConnection, json, requireMember, serviceRequest } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireMember(request);
    const connection = await getDriveConnection(env, user.id);
    if (connection) {
      try {
        const refreshToken = await decryptRefreshToken(env, connection.encrypted_refresh_token);
        await fetch('https://oauth2.googleapis.com/revoke', {
          method:'POST',
          headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
          body:new URLSearchParams({ token:refreshToken }),
        });
      } catch (_error) { /* Deleting Sodium's encrypted copy still disconnects the app. */ }
    }
    const response = await serviceRequest(env, `google_drive_connections?user_id=eq.${encodeURIComponent(user.id)}`, { method:'DELETE' });
    if (!response.ok) return json({ error:'Could not disconnect Google Drive.' }, 502);
    return json({ connected:false });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not disconnect Google Drive.' }, 500);
  }
}
