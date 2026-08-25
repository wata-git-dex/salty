import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

type QueueRecord = {
  id: string;
  recipient: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  source_id: string | null;
};

type WebhookPayload = {
  type: 'INSERT';
  table: 'notification_queue';
  schema: 'public';
  record: QueueRecord;
};

const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (request.headers.get('x-salty-webhook-secret') !== required('PUSH_WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const payload = await request.json() as WebhookPayload;
    const notification = payload.record;
    if (!notification?.id || !notification.recipient) throw new Error('Invalid notification payload');

    const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: subscriptions, error: subscriptionError } = await supabase
      .from('push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .eq('user_id', notification.recipient);
    if (subscriptionError) throw subscriptionError;

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') || 'mailto:saltyviewfinder@gmail.com',
      required('VAPID_PUBLIC_KEY'),
      required('VAPID_PRIVATE_KEY'),
    );

    const message = JSON.stringify({
      title: notification.title,
      body: notification.body,
      url: notification.url,
      tag: `${notification.kind}:${notification.source_id || notification.id}`,
      renotify: notification.kind === 'direct_message' || notification.kind === 'clip_delivery',
    });
    const failures: string[] = [];
    let delivered = 0;

    await Promise.all((subscriptions || []).map(async subscription => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, message, { TTL: 60 * 60 * 12, urgency: ['direct_message','clip_delivery'].includes(notification.kind) ? 'high' : 'normal' });
        delivered += 1;
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode || 0);
        if (status === 404 || status === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
        } else {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    }));

    const update = delivered > 0
      ? { delivered_at: new Date().toISOString(), error: failures.length ? failures.join('; ').slice(0, 1000) : null }
      : { error: (failures.join('; ') || 'No active push subscriptions').slice(0, 1000) };
    const { error: updateError } = await supabase.from('notification_queue').update(update).eq('id', notification.id);
    if (updateError) throw updateError;

    return Response.json({ delivered, failed: failures.length });
  } catch (error) {
    console.error(error);
    return Response.json({ error:error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
