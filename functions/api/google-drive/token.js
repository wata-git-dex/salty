import { json, requireMember } from './_shared.js';

export async function onRequestPost({ request }) {
  try {
    await requireMember(request);
    return json({ error:'Google Picker was retired. Paste a shared folder link instead.' }, 410);
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not open Google Drive.' }, 500);
  }
}
