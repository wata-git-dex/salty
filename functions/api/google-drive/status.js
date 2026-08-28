import { getDriveConnection, googleServiceAccountEmail, json, requireMember } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireMember(request);
    const connection = await getDriveConnection(env, user.id);
    return json({ configured:true, connected:Boolean(connection), mode:'picker_and_shared_folder', sharingEmail:googleServiceAccountEmail(env) });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not check Google Drive.' }, 500);
  }
}
