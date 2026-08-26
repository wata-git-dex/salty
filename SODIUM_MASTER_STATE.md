# Sodium Community App — Master Project State

Updated: August 26, 2026

This file consolidates decisions and implementation state from the Sodium Community App and surf-feature brainstorming threads. The current repository remains the implementation source of truth; this document explains the product intent behind it.

## Release state

- Current release: v1.108.
- This release adds private, text-only Session chats for the organizer and linked members of each surf. Session chats appear beside DMs in Inbox and reuse Sodium reactions, message editing/deletion, unread state, realtime updates, and message notifications.
- `supabase/nonprofit-events-weekly-recap-v1-migration.sql` and `supabase/profile-activity-stats-v1-migration.sql` were applied to production on August 25, 2026.
- `supabase/google-drive-optional-v1-migration.sql` was applied to production on August 25, 2026.

## Native iOS transition

- The Apple Developer membership is active and Xcode installation began on August 26, 2026.
- Sodium now has a committed Capacitor iOS project using bundle ID `com.saltyviewfinder.sodium`; the existing HTML/CSS/JavaScript interface remains the product UI rather than being redesigned.
- Native builds package a curated local web bundle and route protected Stream/Drive API requests to `https://community.saltyviewfinder.com`. Cloudflare API middleware explicitly permits the Capacitor origin without relaxing browser origins generally.
- The first native media bridge uses the iOS Photos picker and AVFoundation to create network-optimized 1080p MP4 copies before the existing resumable Cloudflare Stream upload. Originals remain untouched. The PWA keeps its original-file resumable fallback.
- Native Google authentication is designed to return through `sodium://auth`; this redirect still requires production Supabase allowlist verification before device testing.
- Push, Browser, App Links, Share, Haptics, Splash Screen, and Status Bar Capacitor packages are installed. Native APNs registration and server delivery still require Apple signing/capability configuration after Xcode is ready.
- Do not represent the native build as beta-ready until the Swift media bridge compiles in Xcode and real-device auth, compression, upload, background/interruption, notifications, and deep links pass testing.

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
- A member's own message bubble follows their selected Sodium theme instead of receiving a random speaker color; other senders retain distinct colors for quick scanning.
- DMs remain text-only and private to the two participants.
- Session chats remain text-only and private to the session organizer, linked initiator/featured surfer, and members who joined that surf. A session card exposes **Message crew**, the same thread appears under **Session chats** in Inbox, and finished-session threads remain available with the session history.
- Community Chat stays location-wide, DMs stay one-to-one, and Session chat handles surf-specific coordination. Sodium does not add arbitrary free-form group chats at this stage.
- A sender can edit or delete only their own messages in either chat surface.
- Members can type any phone emoji normally inside message text. Message reactions are intentionally separate and use the packaged Sodium artwork; legacy phone-emoji reactions remain readable and removable.
- Quick reactions appear directly below a message when it is tapped; existing reaction counts remain visible when the picker is closed.
- The packaged Sodium emoji library contains 90 user-supplied transparent pixel-art PNGs organized as Sodium Core, Surf Lore, and Chat Essentials. It is available in both Community Chat and DMs without changing message privacy or exposing uploads publicly.

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

Version 1.103 adds the 90-piece Sodium emoji pack to message reactions. Members keep their normal phone emoji keyboard while writing messages; tapping a message reveals four branded Sodium reactions, and `+` opens categorized Sodium Core, Surf Lore, and Chat Essentials artwork.

Version 1.104 repairs the Stoke composer: people can be tagged as members or typed names, posts can link to a session, saved drafts reopen from Stoke, media-type changes clear stale upload errors, captions support Sodium emoji artwork, and large clips use the supported `tus-js-client` resumable upload path instead of the hand-built retry loop.

The v1.104 production hotfix allows the browser to connect to Cloudflare's direct Stream upload endpoint, which the original content security policy accidentally blocked. It also removes the duplicate draft browser from inside the composer, keeps draft access on the Stoke page, reduces resumable chunks to 5 MiB for mobile connections, and corrects the visible five-minute clip limit.

Version 1.105 is a full release-integrity pass. The service worker now bypasses every `/api/` request so private or changing API responses are never stored in the offline shell, and failed asset requests can no longer be replaced with the app HTML. Static regression checks now cover duplicate IDs, form routing, user-facing action routing, JavaScript-to-HTML selector integrity, cached asset presence, and release-version alignment.

The v1.105 session-date hotfix keeps “Now” as a live-session shortcut only. Once a session is finished or archived, every reference uses its recorded surf/start/end timestamp instead of continuing to display “Now.”

Version 1.106 adds session-based crew messaging. Every eligible surf can have one canonical thread shared by its linked crew, available both from the session card and from Inbox. RLS derives access from the session author, linked initiator/featured surfer, and `session_rsvps`; typed nonmember names do not receive chat access. Session messages are text-only, realtime, editable/deletable by their author, reaction-enabled, unread-aware, and covered by the existing Messages notification preference.

Version 1.107 makes the member boundary visible. Typed nonmember names remain safely listed on the surf, but the session chat identifies only linked Sodium members as chat participants and explicitly marks unlinked names as listed guests. Guests receive no messages, notifications, or access until they join Sodium and the session.

Version 1.108 hardens the current foreground PWA upload path while native media work proceeds. Cloudflare TUS uploads keep the phone awake when supported, retry transient network and offset failures for several minutes, report actual HTTP failures, discard invalid local upload addresses, and automatically replace an expired direct-upload session once without making the member restart the post. This makes the existing original-file uploader reliable; Instagram-style local compression and true background transfer remain requirements of the native iOS media pipeline rather than claims made by the PWA.
