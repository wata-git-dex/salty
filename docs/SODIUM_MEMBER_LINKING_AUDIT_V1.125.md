# Sodium member-linking incident audit — v1.125

Updated: August 27, 2026

This is a focused, code-backed audit of the defect where an existing Sodium member such as Steven Buchan appears as **Guest delivery** inside an older session. It is intended for another engineer or coding agent to reproduce and repair without relying on prior chat claims.

## Executive finding

Steven's Sodium account and the session's `Steven Buchan` entry are currently two different records.

- A real session member is represented by a `session_rsvps` row containing the member's profile UUID.
- A guest is represented only by text in `sessions.participant_names`.
- The affected First Point session is reaching the clip UI without Steven's UUID in `session_rsvps`, so the clip UI correctly describes that session entry as a guest even though a separate Steven profile exists globally.

The user reports that Steven was selected from the member list. The current client can still produce the observed broken state because session text and member links are saved separately and non-atomically. It also blocks repairing a text guest when a member with the same name exists.

This is an application linking defect. It is not evidence that Steven failed to create an account.

## Confirmed code behavior

### 1. Two independent participant representations

The edit composer loads typed names and linked members into separate arrays:

- `app.js:4342` loads `sessions.participant_names` into `state.sessionPeople`.
- `app.js:4343` loads `session_rsvps` into `state.sessionLinkedPeople`.

The database also stores these independently:

- `sessions.participant_names` is a `text[]` guest-name field.
- `session_rsvps.user_id` is the canonical linked member UUID.

The UI therefore cannot infer that a text value and a profile are the same identity unless a linked RSVP exists.

### 2. A guest name prevents selecting the real member

`renderSessionPersonOptions()` builds a set from every text name already in `state.sessionPeople`, then excludes any member whose profile name matches that text:

- `app.js:4256` creates `selected` from text names.
- `app.js:4257` filters `state.people` by name rather than by linked profile UUID.

Result: if `Steven Buchan` already exists as guest text, the real Steven Buchan account disappears from **Choose a surfer**. The user must remove the visible chip before the dropdown offers Steven again. That workaround is not acceptable product behavior.

### 3. Session save is not atomic

The client first updates or inserts the session row:

- `app.js:4437-4442`

Only afterward does it loop over `state.sessionLinkedPeople` and call `add_session_member` once per person:

- `app.js:4443-4447`

If the session update succeeds but an RPC fails, the typed participant names remain saved while the UUID link is absent. The user can therefore receive a partial success state: the surfer is visibly listed, but remains a guest for chat, notifications, clips, and account credit.

There is no database transaction spanning the session update and all crew-link changes.

### 4. Linked names are redundantly saved as guest text

The session payload always writes all visible names to `participant_names`:

- `app.js:4423`

Selecting a member calls `addSessionPerson(person.name, person.id)`, which adds the display name to `state.sessionPeople` and the UUID to `state.sessionLinkedPeople`:

- `app.js:4266-4269`
- `app.js:4277-4283`

That means a correctly selected member is written both as text and as an RSVP. The rendering code attempts to hide the duplicate, but the duplicate text becomes a misleading guest fallback whenever the RSVP write is missing or later removed.

### 5. Clip delivery relies on the UUID link

The session clip hub:

- first adds linked surfers from `session_rsvps` (`app.js:4517`);
- then loops over `participant_names` and tries to find a matching RSVP (`app.js:4518-4520`);
- labels anyone without a resulting `userId` as **Guest delivery** (`app.js:4525`).

Therefore the screenshot is consistent with a missing `session_rsvps` row for Steven on that session.

### 6. Removing linked crew is not synchronized

Removing a chip deletes the person from the two in-memory arrays (`app.js:6443-6449`), but save only upserts current linked users. It does not delete `session_rsvps` rows that were removed in the editor.

This creates the inverse stale-state risk: a person can disappear from the editor while their linked RSVP remains in the database.

### 7. Initiator attribution has the same identity boundary

The initiator is independently stored as `initiator_user` or `initiator_name` (`app.js:4426-4430`). A member who was previously saved as a text-only initiator remains unlinked until an admin explicitly selects the real account. The screenshot showing **Not on Sodium yet** for Jon Hall is the same class of issue.

### 8. Current automated coverage does not catch this

`functions/test/release-integrity.test.mjs` only checks that the `add_session_member` function exists in the migration. There is no behavioral test covering:

- selecting a member;
- saving and reloading the session;
- converting an existing guest to a member;
- removing a linked member;
- partial failure between session save and RSVP save;
- duplicate human names.

## Immediate user impact

A text-only participant:

- appears on the session card;
- is labeled as a guest in Send clips;
- does not receive member-only clip delivery routing;
- is not part of the private session chat;
- does not receive linked session notifications;
- cannot receive attendance/Stoken credit as that account;
- may be hidden from the member picker because their text name is already present.

## Required permanent repair

Do not solve this with automatic global name matching. Two members can share a name, and spelling changes can link private clips or points to the wrong account.

### Database/API

Create one server-side transaction/RPC for saving a session and its crew. It should accept:

- session fields;
- linked member UUIDs and roles;
- guest display names;
- linked initiator UUID or guest initiator name.

In one transaction it must:

1. authorize the organizer/admin;
2. update the session;
3. upsert the requested linked `session_rsvps`;
4. delete linked RSVPs removed by the editor, subject to finished-session/points rules;
5. write only genuine guest names to `participant_names`;
6. return the canonical saved crew.

If any step fails, nothing should be saved.

### Client model

Replace parallel name/UUID arrays with one explicit participant model, for example:

```js
{ kind: 'member', userId: '<uuid>', name: 'Steven Buchan', role: 'surf' }
{ kind: 'guest', name: 'Jon Hall', role: 'surf' }
```

Member identity must be compared by UUID. Guest display names can be compared by normalized text.

### Upgrade flow

When a guest name resembles an existing profile, display an explicit action such as:

**Link “Steven Buchan” to Steven Buchan · Steve the Kraken**

The organizer/admin must confirm it. After confirmation, remove the guest text and create the UUID link transactionally.

An invitation created specifically for that guest can also carry a signed claim reference and link the account when redeemed. Do not link arbitrary existing records merely because names match.

## Acceptance tests required before calling this fixed

1. Select Steven from the member dropdown, save, reload, and confirm Send clips says **Sodium member**.
2. Start with a text-only `Steven Buchan`, link it to Steven's profile without removing/retyping the name, save, and reload.
3. Confirm the linked account receives session chat access and notifications.
4. Confirm attendance credit is attached to the linked UUID exactly once.
5. Remove a linked member and confirm the intended RSVP is deleted without corrupting historical points.
6. Simulate an RPC failure and confirm the session row and crew remain unchanged.
7. Create two members with the same display name and confirm Sodium never auto-links the wrong person.
8. Repeat on active, finished-today, and historical sessions.
9. Link a text-only initiator to an existing member and confirm organizer credit transfers only through the authorized path.
10. Verify PWA and the Capacitor iPhone bundle against the same Supabase data.

## Current release context

- Repository version: v1.125.
- Git head at audit time: `8641c2a Make Stream publication server-owned`.
- This audit made no production data changes.
- Real-device Stream recovery and fresh-account onboarding remain separate release gates documented in `docs/SODIUM_TECHNICAL_HANDOFF_V1.124.md` and `SODIUM_MASTER_STATE.md`.

## Plain conclusion for engineering handoff

The member account exists. The session entry is not linked to it. The current UI can prevent the user from repairing that relationship, and the current two-step save can create partial session records. Repair this as a transactional identity-linking workflow, not as a cosmetic label change and not as an automatic name match.

## v1.126 implementation result

The approved repair is now implemented as an additive migration and one client model:

- `supabase/session-crew-transaction-v1-migration.sql` defines the single security-definer `save_session_with_crew` RPC. It authorizes, locks an edited session, writes only genuine guest names, synchronizes linked RSVP UUIDs/roles, and returns the canonical crew in one database transaction.
- `app.js` now keeps one `sessionParticipants` collection with explicit `member` and `guest` variants. Existing members are compared by UUID, not display name.
- A matching guest name is only a UI suggestion. Linking requires the organizer/admin to confirm the exact profile; no query or migration auto-links by name.
- The former direct session insert/update plus `add_session_member` loop has been removed from the client.
- A stale notification trigger reference to the nonexistent `sessions.general_location` column was discovered by the live rollback test and corrected in the same migration because it blocked all session updates.

### Read-only production damage worklist

`scripts/audit-session-guest-member-matches.sql` was run before the repair. It is a read-only transaction and made no links or mutations. It found three candidate rows for Cyrus to review manually:

| Session ID | Guest text | Matching profile ID |
|---|---|---|
| `0bef0939-0bef-4741-9741-df90409ca4fa` | Steven Buchan | `4e864d53-c980-4999-8789-bad418a288e5` |
| `0ebc7c6c-83c3-4753-88da-0e6b6433ce9e` | Steven Buchan | `4e864d53-c980-4999-8789-bad418a288e5` |
| `b5b529ef-d889-4688-b44e-9f0d4247669d` | Pearce Mendoza | `31b79754-34c6-4ac6-be9e-a900e17b841e` |

These are candidate matches, not proof of identity. They remain unlinked until Cyrus explicitly chooses the correct account in the session editor.

### Verification performed

- The production migration applied successfully.
- `scripts/verify-session-crew-transaction.sql` exercised both edit and create paths with a linked member plus a typed guest inside a transaction.
- The test rolled back and confirmed `retained_smoke_test_rows = 0`.
- Automated release-integrity coverage rejects the old parallel arrays, the old `add_session_member` client loop, or a missing explicit confirmation step.

The separate repository-wide sequential-write review is documented in `docs/SODIUM_SPLIT_WRITE_AUDIT_V1.126.md`. It is report-only; no unrelated flows were changed.
