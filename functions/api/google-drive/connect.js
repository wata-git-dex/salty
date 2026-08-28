import { createOAuthState, googleAuthorizationUrl, json, requireMember } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireMember(request);
    const body = await request.json().catch(() => ({}));
    const options = { native:Boolean(body.native), pick:Boolean(body.pick) };
    const state = await createOAuthState(env, user.id, options);
    return json({ authorizationUrl:googleAuthorizationUrl(env, request, state, options) });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not start the Google Drive connection.' }, 500);
  }
}
