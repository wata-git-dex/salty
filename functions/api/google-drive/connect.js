import { createOAuthState, googleAuthorizationUrl, json, requireMember } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireMember(request);
    const state = await createOAuthState(env, user.id);
    return json({ authorizationUrl:googleAuthorizationUrl(env, request, state) });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not start the Google Drive connection.' }, 500);
  }
}
