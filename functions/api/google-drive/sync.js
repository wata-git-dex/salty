import { countDriveVideoFiles, googleServiceAccountAccessToken, googleServiceAccountEmail, json, requireMember, serviceRequest } from './_shared.js';

const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/u;

async function deliveryForMember(env, deliveryId, userId) {
  const select = 'id,sender,recipient,expected_count,uploaded_count,status,google_folder_id,tracking_mode';
  const response = await serviceRequest(env, `clip_deliveries?id=eq.${encodeURIComponent(deliveryId)}&or=(sender.eq.${encodeURIComponent(userId)},recipient.eq.${encodeURIComponent(userId)})&select=${select}&limit=1`);
  if (!response.ok) throw new Response('Could not read the clip delivery', { status:502 });
  const rows = await response.json();
  return rows[0] || null;
}

async function deliveryForGuest(env, guestToken) {
  const select = 'id,sender,recipient,expected_count,uploaded_count,status,google_folder_id,tracking_mode';
  const response = await serviceRequest(env, `clip_deliveries?guest_access_token=eq.${encodeURIComponent(guestToken)}&select=${select}&limit=1`);
  if (!response.ok) throw new Response('Could not read the clip delivery', { status:502 });
  const rows = await response.json();
  return rows[0] || null;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    let delivery = null;
    const authorization = request.headers.get('Authorization') || '';
    if (authorization.startsWith('Bearer ')) {
      const user = await requireMember(request);
      delivery = await deliveryForMember(env, String(body.deliveryId || ''), user.id);
    } else if (body.guestToken) {
      delivery = await deliveryForGuest(env, String(body.guestToken));
    }
    if (!delivery) return json({ error:'Clip delivery not found.' }, 404);
    if (delivery.tracking_mode !== 'google_drive' || !FOLDER_ID_PATTERN.test(delivery.google_folder_id || '')) {
      return json({ error:'This delivery uses manual counting.' }, 409);
    }
    const accessToken = await googleServiceAccountAccessToken(env);
    const driveVisibleCount = await countDriveVideoFiles(accessToken, delivery.google_folder_id);
    // Never erase a count the filmer confirmed manually if Drive metadata is delayed.
    const count = Math.max(Number(delivery.uploaded_count) || 0, driveVisibleCount);
    const status = count >= delivery.expected_count ? 'ready' : 'uploading';
    const update = await serviceRequest(env, `clip_deliveries?id=eq.${encodeURIComponent(delivery.id)}`, {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' },
      body:JSON.stringify({ uploaded_count:count, status }),
    });
    if (!update.ok) return json({ error:'Could not update the clip count.' }, 502);
    return json({ deliveryId:delivery.id, uploadedCount:count, driveVisibleCount, expectedCount:delivery.expected_count, status, sharingEmail:googleServiceAccountEmail(env) });
  } catch (error) {
    if (error instanceof Response) return json({ error:await error.text(), sharingEmail:env.GOOGLE_SERVICE_ACCOUNT_JSON ? googleServiceAccountEmail(env) : null }, error.status);
    return json({ error:'Could not refresh the Google Drive count.' }, 500);
  }
}
