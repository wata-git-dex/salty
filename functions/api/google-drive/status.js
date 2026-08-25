import { getDriveConnection, json, requireMember } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireMember(request);
    const connection = await getDriveConnection(env, user.id);
    return json({ connected:Boolean(connection), email:connection?.google_email || null });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not check Google Drive.' }, 500);
  }
}
