import { countDriveVideoFiles, googleServiceAccountAccessToken, json, serviceRequest } from './_shared.js';

const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/u;

function authorized(request, env) {
  const supplied = request.headers.get('X-Sodium-Sync-Secret') || '';
  return Boolean(env.CLIP_SYNC_SECRET && supplied && supplied === env.CLIP_SYNC_SECRET);
}

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json({ error:'Not found.' }, 404);
  try {
    const response = await serviceRequest(env, 'clip_deliveries?tracking_mode=eq.google_drive&status=eq.uploading&google_folder_id=not.is.null&select=id,sender,expected_count,uploaded_count,google_folder_id&order=updated_at.asc&limit=200');
    if (!response.ok) return json({ error:'Could not load pending clip deliveries.' }, 502);
    const deliveries = await response.json();
    const accessToken = await googleServiceAccountAccessToken(env);
    const results = [];

    for (const delivery of deliveries) {
      if (!FOLDER_ID_PATTERN.test(delivery.google_folder_id || '')) continue;
      try {
        const driveVisibleCount = await countDriveVideoFiles(accessToken, delivery.google_folder_id);
        // Background sync can advance a handoff but never lower a filmer-confirmed count.
        const count = Math.max(Number(delivery.uploaded_count) || 0, driveVisibleCount);
        const status = count >= Number(delivery.expected_count) ? 'ready' : 'uploading';
        if (count === Number(delivery.uploaded_count) && status === 'uploading') continue;
        const update = await serviceRequest(env, `clip_deliveries?id=eq.${encodeURIComponent(delivery.id)}`, {
          method:'PATCH',
          headers:{ 'Content-Type':'application/json', Prefer:'return=minimal' },
          body:JSON.stringify({ uploaded_count:count, status }),
        });
        if (!update.ok) throw new Error('Database update failed');
        results.push({ id:delivery.id, count, driveVisibleCount, status });
      } catch (error) {
        console.warn('Scheduled Drive sync deferred:', delivery.id, error?.message || error);
      }
    }
    return json({ checked:deliveries.length, updated:results.length, ready:results.filter(item => item.status === 'ready').length });
  } catch (error) {
    console.error('Scheduled Drive sync failed:', error);
    return json({ error:'Scheduled Drive sync failed.' }, 500);
  }
}
