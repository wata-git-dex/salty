# Salty push deployment

The client public VAPID key is intentionally public in `app.js`. Never commit the private VAPID key or webhook secret.

1. Run `push-points-v1-migration.sql` in the Supabase SQL editor.
2. Deploy `supabase/functions/push/index.ts` as the `push` Edge Function with JWT verification disabled.
3. Set Edge Function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `PUSH_WEBHOOK_SECRET`.
4. Create a Database Webhook named `send-push-notification`:
   - Table: `public.notification_queue`
   - Event: `INSERT`
   - Method: `POST`
   - URL: `https://maihhnwrstewzapsvrec.supabase.co/functions/v1/push`
   - Header: `x-salty-webhook-secret: <PUSH_WEBHOOK_SECRET>`

The function removes expired subscriptions after push services return HTTP 404 or 410.
