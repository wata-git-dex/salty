# Sodium Community App — Master Project State

Updated: August 25, 2026

This file consolidates decisions and implementation state from the Sodium Community App and surf-feature brainstorming threads. The current repository remains the implementation source of truth; this document explains the product intent behind it.

## Release state

- Current release: v1.87.
- This release combines the v1.86 nonprofit/event work with the v1.87 profile activity-stat and navigation work.
- `supabase/nonprofit-events-weekly-recap-v1-migration.sql` and `supabase/profile-activity-stats-v1-migration.sql` were applied to production on August 25, 2026.

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
- Your Sodium: Points & streaks, Community rules
- App: Beta Feedback, Settings, About Sodium

Nonprofit events live inside Events with Community / Nonprofit filters. They do not require another primary tab or drawer row.

## Profile statistics

Profile stats use three switchable panels:

### Community

- Points
- Active streak
- Stoke posts

### Surf

- Completed sessions surfed
- Time in water
- Sessions organized
- Locations surfed

### Film + photo

- Completed sessions filmed
- Time filming
- Individual clips shared
- Individual photos shared
- Individual clips received through clip deliveries
- Photos in which the member is tagged

`clips received` means the literal number of delivered clip files. A delivery of 25 files adds 25, whether those files are waves, B-roll, or another kind of footage. It is not a wave count.

Sodium does not attempt to count waves automatically.

Session duration is measured only from a trustworthy `started_at` to `ended_at`. Scheduled times are not surf duration. Older records keep their participation counts but do not receive invented duration when their timestamps are ambiguous.

## Sessions

- A member can initiate a session as a surfer or filmer.
- Other members can join to surf; filming is offered when the session asks for clips or already has a filmer.
- A planned session becomes active when its organizer taps Start surf.
- Stopping it moves it to Past sessions and awards eligible points once.
- Admin attribution can credit the person who actually initiated a session, including a pending nonmember who later claims it.
- Sessions can be edited, cancelled, shared externally, or shared directly with an existing Sodium member.

## Stoke and media

- Photo posts support up to 10 images in their original orientation or an optional fixed crop.
- Clip posts support up to five Cloudflare Stream videos, 90 seconds and 1 GB maximum per clip.
- Drafts remain on the device for 30 days.
- Linked member tags and custom visual tags are supported.
- Photos and clips can be edited or deleted by their author.

## Clip deliveries

- Clip deliveries link to Drive, Dropbox, iCloud, or another external folder.
- The sender specifies the expected clip count and the recipient can be a member or a named guest.
- Guest links expose only that delivery, not the Sodium community.
- The clip outbox allows the sender to reopen, edit, and reshare deliveries.
- A recipient joining Sodium can claim a prepared delivery.

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

## Immediate release checklist

1. Re-run JavaScript and visual preview checks.
2. Commit the v1.86 nonprofit work and v1.87 profile/menu work together as one coherent release.
3. Push to `origin/main` and verify the deployed version, profile stat panels, Events filters, and grouped drawer.
