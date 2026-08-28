import { authorizeSelectedFolder, json, requireMember } from './_shared.js';

const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/u;

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireMember(request);
    const body = await request.json();
    const folderId = String(body.folderId || '').trim();
    if (!FOLDER_ID_PATTERN.test(folderId)) return json({ error:'Choose a valid Google Drive folder.' }, 400);
    const folder = await authorizeSelectedFolder(env, user.id, folderId);
    return json({ folder });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Google Drive folder selection failed:', error);
    return json({ error:'Sodium could not connect that Drive folder.' }, 500);
  }
}
