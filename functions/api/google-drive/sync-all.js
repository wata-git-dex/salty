import { getDriveConnection, json, refreshGoogleAccessToken, serviceRequest } from './_shared.js';

const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/u;

function authorized(request, env) {
  const supplied = request.headers.get('X-Sodium-Sync-Secret') || '';
  return Boolean(env.CLIP_SYNC_SECRET && supplied && supplied === env.CLIP_SYNC_SECRET);
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
    if (!response.ok) throw new Error(`Drive count failed (${response.status})`);
    total += (payload.files || []).filter(file => String(file.mimeType || '').startsWith('video/')).length;
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return Math.min(2000, total);
}

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json({ error:'Not found.' }, 404);
  try {
    const response = await serviceRequest(env, 'clip_deliveries?tracking_mode=eq.google_drive&status=eq.uploading&google_folder_id=not.is.null&select=id,sender,expected_count,uploaded_count,google_folder_id&order=updated_at.asc&limit=200');
    if (!response.ok) return json({ error:'Could not load pending clip deliveries.' }, 502);
    const deliveries = await response.json();
    const accessTokens = new Map();
    const failedSenders = new Set();
    const results = [];

    for (const delivery of deliveries) {
      if (!FOLDER_ID_PATTERN.test(delivery.google_folder_id || '') || failedSenders.has(delivery.sender)) continue;
      try {
        if (!accessTokens.has(delivery.sender)) {
          const connection = await getDriveConnection(env, delivery.sender);
          if (!connection) { failedSenders.add(delivery.sender); continue; }
          accessTokens.set(delivery.sender, await refreshGoogleAccessToken(env, connection.encrypted_refresh_token));
        }
        const count = await countVideoFiles(accessTokens.get(delivery.sender), delivery.google_folder_id);
        const status = count >= Number(delivery.expected_count) ? 'ready' : 'uploading';
        if (count === Number(delivery.uploaded_count) && status === 'uploading') continue;
        const update = await serviceRequest(env, `clip_deliveries?id=eq.${encodeURIComponent(delivery.id)}`, {
          method:'PATCH',
          headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' },
          body:JSON.stringify({ uploaded_count:count, status }),
        });
        if (!update.ok) throw new Error('Database update failed');
        results.push({ id:delivery.id, count, status });
      } catch (error) {
        if (/reconnect/i.test(error?.statusText || error?.message || '')) failedSenders.add(delivery.sender);
        console.warn('Scheduled Drive sync deferred:', delivery.id, error?.message || error);
      }
    }
    return json({ checked:deliveries.length, updated:results.length, ready:results.filter(item => item.status === 'ready').length });
  } catch (error) {
    console.error('Scheduled Drive sync failed:', error);
    return json({ error:'Scheduled Drive sync failed.' }, 500);
  }
}
