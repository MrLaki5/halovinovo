# Halloween Costume Vote — implementation spec

Hand this folder to Claude Code. `SPEC.md` is the source of truth for behaviour; `design/*.dc.html` are the visual reference for every screen (layout, copy, colors, spacing). The `.dc.html` files are Design-canvas components: read the markup and inline styles as the design; ignore the `<x-dc>`, `<sc-for>`, `<sc-if>`, `{{…}}` and `class Component extends DCLogic` wrappers, which are canvas-only.

## Product in one paragraph

A mobile-only web app for one Halloween party. The host (the only account) photographs each guest's mask on arrival and adds it to a public gallery. Guests open the site on their phones, no login, and vote for up to 3 masks before a timer set by the host runs out. When voting closes, the top N masks become finalists for a live contest at the party. After the live final the host enters 1st, 2nd and 3rd place, and every guest's screen shows the podium. The host can reset everything for the next party.

## Platform

- Mobile-first, phone-only. Design width 390 px; content column `max-width: 480px`, centered on larger screens.
- Any stack is fine. Needs: image upload/storage, a small database, and live updates (vote counts, phase changes) via websockets/SSE or polling every ~3 s.
- Suggested: Next.js + SQLite/Postgres (or Supabase for DB + storage + realtime).

## Phases (single global state machine)

`checkin → voting → final → winners`

| Phase | Guest sees | Entered by |
|---|---|---|
| checkin | Vote screen, gallery visible, voting disabled ("Voting opens soon") | Default / after reset |
| voting | Vote screen with countdown | Host saves settings with a close time / starts voting |
| final | Finalists screen | Timer reaches `votingClosesAt`, or host taps "End voting now" |
| winners | Winners podium | Host taps "Publish winners" |

Guest pages must switch automatically when the phase changes (no manual refresh).

## Data model

```
Settings (single row)
  partyName        string (default "Halovinovo", max 40 chars; editable in Host · Settings; shown in every header)
  phase            'checkin' | 'voting' | 'final' | 'winners'
  votingClosesAt   datetime | null
  finalistCount    int   (default 5, 2–10)
  votesPerGuest    int   (default 3, 1–5)
  showVoteCounts   bool  (default true)

Mask
  id, number (auto-increment display number, shown as #01, #02…)
  photoUrl
  label            string | null   (host-only, never sent to guests)
  createdAt

Vote
  id, maskId, voterId, createdAt
  unique(maskId, voterId)

Winner
  place (1|2|3), maskId, name, costumeTitle | null
```

## Guest identity and vote rules

- No login. Issue an anonymous `voterId` (UUID) in a long-lived cookie on first visit.
- A guest can vote for at most `votesPerGuest` distinct masks, max one vote per mask.
- Guests can toggle votes freely until they tap **Lock in my votes**; after that votes are final (store `lockedAt` per voter).
- Optional hardening: require a party code / QR link to open the guest site.
- Server enforces all limits and rejects votes outside the `voting` phase.

## Vote counts

- If `showVoteCounts` is **on**: guests see each mask's live count from the start of voting (Vote screen) and on the Finalists screen.
- If **off**: counts are hidden from guests everywhere. The host always sees counts.

## Finalists

- When voting closes, take the top `finalistCount` masks by vote count.
- Ties at the cut-off: include all tied masks (document this; or let the host pick — choose one and note it).

## Screens

### Guest · Vote (`design/Main.dc.html`)
- Sticky header: party name, countdown pill `HH:MM:SS` to `votingClosesAt`.
- Intro: "Round 1 · Everyone votes", heading, line mentioning top N.
- 2-column grid of mask cards: photo (3:4), `#NN` badge, orange check badge when voted, vote count (if enabled), full-width Vote / Voted / Out of votes button. Card border turns orange when voted; other cards dim when votes are used up.
- Sticky bottom bar: "2 of 3 picked · #02, #07", 3 progress dots, full-width **Lock in my votes** (disabled with 0 votes; becomes "Votes locked").

### Guest · Finalists (`design/Finalists.dc.html`)
- Header pill "Voting closed". Ranked list rows: thumbnail, "Finalist N", `#NN`, vote count (if enabled). Note: "Winners appear here once the host announces them."

### Guest · Winners (`design/Winners.dc.html`)
- 1st place: large full-width card, orange footer with trophy, name, costume title. 2nd and 3rd side by side below.

### Host · Login (`design/Admin-Login.dc.html`)
- Email + password, single host account (seed from env vars). Session cookie. All `/admin` routes and admin APIs require it.

### Host · Check-in (`design/Admin-Entries.dc.html`)
- Status tiles: phase, time left, masks count, guests who voted.
- "Check in a mask": big tap target that opens the phone camera (`<input type="file" accept="image/*" capture="environment">`), optional hidden label, shows next number, **Add to gallery**. Compress/resize images client-side (~1200 px long edge, JPEG/WebP).
- Gallery: 3-column grid with number, count, delete (confirm before deleting).
- Bottom tab bar: Check-in · Settings · Winners. Log-out icon top right.

### Host · Settings (`design/Admin-Settings.dc.html`)
- Phase stepper (Check-in / Voting / Final / Winners).
- Fields: Party name (default "Halovinovo"), Voting closes at (datetime), Finalists (top N), Votes per guest, Show vote counts (checkbox).
- **Save settings**, **End voting now**.
- **Reset tournament** (danger zone) → bottom-sheet confirm "Are you sure?" with **Yes, reset everything** / **Cancel**. Reset deletes all masks (and stored photos), votes, voter locks, winners, and restores default settings; phase back to `checkin`. Show a success message after.

### Host · Winners (`design/Admin-Winners.dc.html`)
- Three fieldsets (1st, 2nd, 3rd): mask select (finalists only, each mask used once), winner's name, optional costume title, thumbnail of the chosen mask.
- **Publish winners** → phase `winners`. **Preview podium** link.

## Design tokens

Colors
- Background `#14101A` · Surface `#1E1826` · Raised `#2A2133`
- Border `#2E2638` / strong `#3A3046` / input `#4A3F57`
- Text `#F2EADF` · Muted text `#B5ABC1`
- Accent (pumpkin) `#FF7A1A`, accent text/links `#FF9A4D`, text on accent `#1A0F05`
- 2nd place `#D9CFC2` · 3rd place `#C48A5A` / `#D9A27A`
- Danger `#FF8A8A` on `#1E1418`, border `#6B2E36` · Success `#CDEBC8` on `#1E2A1E`
- Photo placeholder: diagonal stripes `#231C2C` / `#1C1724`

Type
- Bricolage Grotesque (400/600/800) for all UI; JetBrains Mono (500/700) for numbers, timer, mask IDs. Google Fonts.
- H1 30–38 px / 800 / -0.03em; body 15 px; labels 13–14 px; inputs 17 px (prevents iOS zoom).

Shape and touch
- Radii: cards 14–18 px, buttons 14 px, inputs 12 px, pills 999 px.
- Touch targets ≥ 44 px; primary buttons 52 px tall, full width.
- Icons: simple 2 px stroke line icons (camera, clock, trophy, trash, log-out, sliders). No emoji.

## Accessibility
- Real `<button>`, `<a>`, `<label>`/`<input>`; `aria-pressed` on vote buttons; `aria-label` on icon-only buttons; confirm sheet is `role="alertdialog"` with focus trap; text contrast ≥ 4.5:1 (the palette above passes).

## Open items to confirm with the host
- Whether to add a party code/QR gate.
- Tie-break rule at the finalist cut-off.
- Whether locked votes are required or votes auto-lock when the timer ends (recommend: auto-count unlocked votes too).
