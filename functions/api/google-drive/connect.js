import { json, requireMember } from './_shared.js';

export async function onRequestPost({ request }) {
  try {
    await requireMember(request);
    return json({ error:'Google account connection was retired. Share only the delivery folder with Sodium instead.' }, 410);
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not start the Google Drive connection.' }, 500);
  }
}
