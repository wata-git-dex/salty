import { googleServiceAccountEmail, json, requireMember } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireMember(request);
    void user;
    return json({ configured:true, mode:'shared_folder', sharingEmail:googleServiceAccountEmail(env) });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not check Google Drive.' }, 500);
  }
}
