import { getDriveConnection, json, refreshGoogleAccessToken, requireMember, serviceRequest } from './_shared.js';

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

async function countVideoFiles(accessToken, folderId) {
  let pageToken = '';
  let total = 0;
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,mimeType)');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers:{ Authorization:`Bearer ${accessToken}` } });
    const payload = await response.json();
    if (!response.ok) throw new Response(response.status === 403 ? 'Reconnect or reselect this Google Drive folder' : 'Could not count the Google Drive clips', { status:response.status === 403 ? 409 : 502 });
    total += (payload.files || []).filter(file => String(file.mimeType || '').startsWith('video/')).length;
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return total;
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
    const connection = await getDriveConnection(env, delivery.sender);
    if (!connection) return json({ error:'The filmer disconnected Google Drive. Manual counting still works.' }, 409);
    const accessToken = await refreshGoogleAccessToken(env, connection.encrypted_refresh_token);
    const count = Math.min(2000, await countVideoFiles(accessToken, delivery.google_folder_id));
    const status = count >= delivery.expected_count ? 'ready' : 'uploading';
    const update = await serviceRequest(env, `clip_deliveries?id=eq.${encodeURIComponent(delivery.id)}`, {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' },
      body:JSON.stringify({ uploaded_count:count, status }),
    });
    if (!update.ok) return json({ error:'Could not update the clip count.' }, 502);
    return json({ deliveryId:delivery.id, uploadedCount:count, expectedCount:delivery.expected_count, status });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error:'Could not refresh the Google Drive count.' }, 500);
  }
}
