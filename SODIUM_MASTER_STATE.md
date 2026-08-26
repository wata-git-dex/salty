# Sodium Community App — Master Project State

Updated: August 25, 2026

This file consolidates decisions and implementation state from the Sodium Community App and surf-feature brainstorming threads. The current repository remains the implementation source of truth; this document explains the product intent behind it.

## Release state

- Current release: v1.99.
- This release gives Community Chat and DMs sender profile photos, distinct sender colors, owner-only message editing/deletion, and positive emoji reactions. DM reactions remain visible only to the two conversation participants; Community Chat reactions remain member-only.
- `supabase/nonprofit-events-weekly-recap-v1-migration.sql` and `supabase/profile-activity-stats-v1-migration.sql` were applied to production on August 25, 2026.
- `supabase/google-drive-optional-v1-migration.sql` was applied to production on August 25, 2026.

## Core product

Sodium is a private, invite-only surf community app for organizing sessions, finding friends or filmers, delivering clips, sharing Stoke, chatting, planning events, and supporting things made or done by community members.

Preserve the existing approved visual system, swirl icon, themes, PWA behavior, Supabase-backed data, Cloudflare deployment, and mobile-first interaction patterns.

## Current navigation

The five daily destinations remain:

1. Sessions
2. Stoke
3. Chat
4. Events
5. Profile

The right-side drawer is grouped to prevent a long undifferentiated list:

- Crew: Share + invite, Members, Clubs
- Discover: Marketplace, Perks & discounts
- Your Sodium: Stokens & streaks, Community rules
- App: Beta Feedback, Settings, About Sodium

Nonprofit events live inside Events with Community / Nonprofit filters. They do not require another primary tab or drawer row.

## Profile statistics

Profile stats use three switchable panels:

### Community

- Stokens (the user-facing name for the existing participation-points ledger)
- Active streak
- Stoke posts

### Surf

- Completed sessions surfed
- Time in water
- Sessions organized
- Unique locations where the member surfed or filmed

### Film + photo

- Completed sessions filmed
- Time filming
- Clip handoffs sent through Clip Delivery
- Individual clips delivered through Clip Delivery
- Individual clips received through Clip Delivery

`clips delivered` and `clips received` mean the literal number of files in Clip Delivery. A delivery of 25 files adds 25, whether those files are waves, B-roll, or another kind of footage. It is not a wave count, and Stoke posts do not inflate these totals.

`locations` is one combined count of unique surf spots across completed sessions where the member surfed or filmed. Sodium does not split surf locations from film locations because both roles took place at the same surf location.

`Stokens` is a safe user-facing rename. Legacy internal identifiers such as `points_events`, point-award functions, and database columns remain unchanged to preserve existing data and avoid a risky cosmetic migration.

Sodium does not attempt to count waves automatically.

Session duration is measured only from a trustworthy `started_at` to `ended_at`. Scheduled times are not surf duration. Older records keep their participation counts but do not receive invented duration when their timestamps are ambiguous.

## Sessions

- A member can initiate a session as a surfer or filmer.
- Other members can join to surf; filming is offered when the session asks for clips or already has a filmer.
- A planned session becomes active when its organizer taps Start surf.
- Stopping it moves it to Past sessions and awards eligible Stokens once.
- Admin attribution can credit the person who actually initiated a session, including a pending nonmember who later claims it.
- Sessions can be edited, cancelled, shared externally, or shared directly with an existing Sodium member.

## Stoke and media

- Photo posts support up to 10 images in their original orientation or an optional fixed crop.
- Clip posts support up to five Cloudflare Stream videos, five minutes and 1 GB maximum per clip.
- Drafts remain on the device for 30 days.
- Linked member tags and custom visual tags are supported.
- Photos and clips can be edited or deleted by their author.
- Members can give posts **Stoke** with the wave reaction and leave comments. There are no negative reactions or downvotes. Legacy `post_likes` identifiers remain internal to avoid an unnecessary data migration.

## Chat

- Community Chat supports text, photos, full-name `@` mentions, sender profile photos, and distinct sender colors.
- DMs remain text-only and private to the two participants.
- A sender can edit or delete only their own messages in either chat surface.
- Message reactions are positive-only: wave, fire, laugh, and heart. There is no negative reaction or shaka emoji.

## Clip deliveries

- Clip deliveries link to Drive, Dropbox, iCloud, or another external folder.
- The sender specifies the expected clip count and the recipient can be a member or a named guest.
- Guest links expose only that delivery, not the Sodium community.
- Guest links lead to **Open your clips** first. No Sodium account is required; joining is optional.
- Clip deliveries do not have their own chat. Members can use a normal DM when they need to talk.
- The clip outbox allows the sender to reopen, edit, and reshare deliveries.
- A recipient joining Sodium can claim a prepared delivery.
- Google Drive is optional. A filmer may connect with the narrow `drive.file` permission, choose one folder with Google Picker, and let Sodium refresh its completed-video count while a sender, recipient, or guest is viewing the delivery.
- Sodium never requires the broad full-Drive read scope. Manual Drive, Dropbox, iCloud, and other HTTPS folder links remain the permanent fallback.
- Google refresh tokens are encrypted server-side and are never stored in the browser or exposed through Supabase member policies.

## Events and nonprofits

- Events have start/end times, venue/location, RSVP, calendar export, edit/delete, sharing, and a collapsed past-events section.
- Events can be Community or Nonprofit events.
- Admins can manage lightweight nonprofit profiles with a name, description, website, logo, visibility, and related events.
- Water Access To All is the initial nonprofit profile.
- Nonprofit profiles are not a separate social network or marketplace.

## Marketplace boundary

Marketplace is a lightweight directory of what members make or do. It can link to external shops or booking destinations and optionally show a member perk. Sodium does not provide carts, checkout, payment processing, inventory, orders, shipping, taxes, commissions, or payouts.

## Documentation and visual assets

- Use the user's supplied surf photography for Sodium guides and graphics.
- Do not substitute random stock or AI-generated surf photography.
- Use first names by default in fictional/sample community states.
- Do not regenerate training PDFs or one-pagers for minor UI adjustments unless the user asks.

## Current release

Version 1.88 repairs profile activity totals, combines surf and film locations, distinguishes Clip Delivery from Stoke posts, introduces Stokens as the participation currency's user-facing name, adds a Nonprofits drawer shortcut, and prevents the page behind the mobile drawer from scrolling.

Version 1.89 adds the optional Google Drive folder picker and view-time clip counting. It does not add a paid background job, change existing clip-delivery records, or require members to connect Google.

Version 1.90 makes phone clip uploads resilient to brief network interruptions and replaces the generic heart/like presentation with the positive-only action of giving a post Stoke. Existing reaction data is preserved.

Version 1.91 raises the per-clip duration cap to five minutes while retaining the 1 GB file cap and five-clip carousel limit. It also uses Cloudflare’s required 5 MiB minimum TUS chunk size for large resumable uploads.

Version 1.92 simplifies clip sharing for both audiences. Member links open the saved Sodium delivery; guest links open a delivery-only landing page with **Open your clips** as the primary action and optional membership second. Delivery-specific messages are removed, and every active invite PNG/PDF is refreshed to match the current behavior and media limits.
