# Sodium sequential-write audit — v1.126

Updated: August 27, 2026

## Scope

This is a report-only sweep for the same failure shape that caused the session/member-linking incident: related state is written in more than one awaited Supabase or external-service operation, without one database transaction/RPC owning the invariant.

No finding below was changed as part of the member-linking repair. Each needs its own product and migration review. Read-only queries, independent single-row actions, and multi-step flows already contained inside a PostgreSQL function were excluded.

## High-priority findings

### 1. Stoke tag replacement can erase all tags on partial failure

- `app.js:5521-5529` deletes every `post_tags` row, then inserts the replacement set in a second request.
- If the insert fails after the delete commits, the post permanently loses its prior member tags.
- Editing a post compounds this: `app.js:5602-5606` commits post details first and only then replaces tags.

Recommended review: one `replace_post_tags` RPC that authorizes the post owner and replaces the complete set transactionally.

### 2. Stream webhook finalization is still two database writes

- Failure path: `functions/api/stream/webhook.js:50-57` marks the media row failed, then marks the parent post failed.
- Ready path: `functions/api/stream/webhook.js:94-103` marks one media row ready; `functions/api/stream/webhook.js:105-117` separately rereads the post and all media; `functions/api/stream/webhook.js:119-125` then publishes the parent post.
- A failure between the media update and post update can leave a ready/error media row with a stale pending post. Because Cloudflare may not send the identical terminal webhook again, this can become durable.

Recommended review: a service-only PostgreSQL RPC that records one verified Stream event and atomically derives the parent post status.

### 3. Photo Stoke creation can leave files or a partially described post

- `app.js:5649-5657` uploads every photo to Storage before any post row exists.
- `app.js:5659-5661` creates the published post only after all uploads.
- `app.js:5664` adds tags in another database operation.
- If post creation fails, uploaded files are orphaned. If tag replacement fails, the post is already published without the intended member tags.

Recommended review: create a private pending post first, register media rows/paths, and publish plus tags through a server-owned transaction after all uploads exist.

### 4. Inline nonprofit event creation can create an organization without its event

- `app.js:3799-3805` inserts a nonprofit and optionally updates its logo path.
- `app.js:3828-3831` creates the event afterward.
- Any later failure leaves a nonprofit row (and possibly a logo object) even though the requested event was not created.

Recommended review: separate nonprofit creation from event creation in the UI, or use one admin RPC for the database rows with explicit Storage compensation.

## Medium-priority findings

### 5. Profile completion spans Storage, profile, and location membership

- `app.js:1292-1298` uploads an avatar.
- `app.js:1300-1307` updates the profile.
- `app.js:1311-1316` separately joins the invite location, and currently ignores a join error.
- Failure can leave an orphan avatar, a completed profile without the intended membership, or a UI that reports success while the location join did not happen.

Recommended review: a profile-completion RPC for profile plus membership, with explicit post-commit Storage cleanup/reconciliation.

### 6. Marketplace listing image save is a three-stage partial-commit flow

- `app.js:3216-3219` creates/updates the listing.
- `app.js:3220-3225` uploads an image and then updates `image_path`.
- `app.js:3227` deletes the prior image last.
- Failures can leave a listing without the selected image or leave new/old Storage objects orphaned.

Recommended review: pending media state plus one finalize RPC; retain an asynchronous orphan cleanup job for Storage.

### 7. Nonprofit logo save has the same partial-commit shape

- `app.js:3661-3664` creates/updates the nonprofit row.
- `app.js:3665-3672` uploads the logo, updates `logo_path`, and removes the prior logo in separate calls.
- The code compensates for one failed path update, but a failed cleanup or interrupted client can still leave row/object disagreement.

Recommended review: pending logo state and a server-owned finalize operation.

### 8. Spot creation/update happens before the new session transaction

- `app.js:4219-4243` creates or updates a `spots` row.
- `app.js:4470` later calls the atomic `save_session_with_crew` RPC.
- The session and crew are now atomic, but a rejected session can still leave a newly created unused spot or a location edit that the user only intended for that session.

Recommended review: decide whether spots are independent reusable records. If not, include spot upsert in a future session-save RPC.

## Lower-priority or compensated cross-system findings

### 9. Chat photo and beta screenshot creation rely on best-effort cleanup

- Community chat: Storage upload at `app.js:1691-1695`, message insert at `app.js:1697-1701`, compensating delete at `app.js:1705-1707`.
- Beta reports: Storage upload at `app.js:3377-3385`, report insert at `app.js:3397`, compensating delete at `app.js:3398-3400`.
- Compensation is better than silent partial success, but it cannot be atomic across Storage and Postgres and can itself fail if the client closes or loses connectivity.

Recommended review: periodic orphan cleanup and an explicit media state, not a database-only transaction claim.

### 10. Deletion commits database removal before media cleanup

- Message deletion: database row at `app.js:2305`, Storage object at `app.js:2307`.
- Marketplace listing deletion: database row at `app.js:3240`, Storage object at `app.js:3242`.
- Stoke deletion: database row at `app.js:5716`, then Stream or Storage cleanup at `app.js:5718-5725`.
- Users see the correct deletion, but failed cleanup can leak paid Storage/Stream objects.

Recommended review: durable server cleanup queue keyed by the deleted record/media IDs.

### 11. Stream upload initialization crosses Cloudflare and Supabase

- `functions/api/stream/upload.js:39-52` creates a Cloudflare Stream upload.
- `functions/api/stream/upload.js:56-83` then links that UID to `post_stream_media`.
- Retry of a failed post separately resets the parent at `functions/api/stream/upload.js:86-95`.
- New Stream assets are deleted on known linking/reset failures, but process termination or failed cleanup can still leave an untracked asset; media link and parent retry state are not one transaction.

Recommended review: make the Supabase link/reset one RPC and add a scheduled Stream orphan reconciler.

### 12. Push delivery bookkeeping is intentionally eventual, not atomic

- `supabase/functions/push/index.ts:63-78` sends notifications and deletes invalid subscriptions.
- `supabase/functions/push/index.ts:80-84` updates the notification queue afterward.
- A function interruption can deliver a push without recording `delivered_at`, causing ambiguous retry behavior.

Recommended review: explicit attempt IDs/idempotency and retry semantics. A database transaction cannot make the external web-push send atomic.

## Important distinction

Not every cross-service workflow can be made truly atomic. PostgreSQL cannot roll back an already uploaded Storage object, a sent push, or a created Cloudflare Stream asset. The safe pattern is:

1. one database transaction owns the canonical state transition;
2. external work is idempotent and keyed to that state;
3. failures are persisted as visible states;
4. a server-side reconciler retries or cleans up abandoned objects.

The new `save_session_with_crew` RPC now follows the transactional part of that pattern for sessions and linked crew. None of the findings above were bundled into that change.
