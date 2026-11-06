# SyncView — Synchronized Reaction-Video Platform

SyncView is a high-performance web platform designed for watching original source content alongside one or more creator reaction videos with synchronized playback, intelligent multi-timeline drift correction, and server-authoritative watch parties.

---

## 🚀 Key Features

1. **Intelligent Piecewise Linear Synchronization Engine (`src/services/syncEngine.ts`)**:
   - Maps source time to reaction time across intro offsets, creator pauses, skips/cuts, and outros.
   - Provides deterministic mapping for ambiguous timeline points (e.g. holding source time while creator talks).
   - Inverse mapping (`reactionTime -> sourceTime`) for bidirectional navigation.
   - Micro-drift detection and smooth rate compensation (`0.95x` or `1.05x`) without pitch distortions.
   - Hard seek recovery for drifts exceeding threshold (> 1.2s).
   - Stalling and buffering recovery across all video elements.

2. **Dual Platform Experience (Viewer & Reactor)**:
   - **Viewer Mode**: Content-first streaming platform with featured hero showcase, category filters (Movies & TV, Gaming, Music, Tech, Sports), search, user library, and watch parties.
   - **Reactor Mode**: Creator dashboard, 4-step guided Reaction Creation Wizard, drafts management, and timing best practices guide.

3. **Theatre Viewing Experience (`src/components/theatre/Theatre.tsx`)**:
   - Supports 1 source video + 1 primary reaction + up to 4 additional reactors (up to 6 players simultaneously).
   - Layout switcher: Side-by-Side (50/50), Source Focus, Reactor Focus, Grid, Picture-in-Picture.
   - Audio routing: Audio Focus selector, individual volume sliders, mute toggles, and smart audio ducking.
   - Basic vs Advanced Mode: Clean status indicators for viewers, deep diagnostics (real-time drift in ms, target clocks, compensation rates, anchor tables) for power users.
   - Reaction intelligence: Chapters, climax highlights, and real-time timestamped community notes.

4. **Creator Studio & Calibration (`src/components/reactor/CreatorStudio.tsx`)**:
   - Dual-frame interactive scrubber to align source and reaction frames.
   - 1-click anchor creation (`Source Time -> Reaction Time`).
   - Anchor types: `intro`, `linear`, `pause`, `skip`, `outro`.
   - CSV export & import for backup or batch editing.
   - Chapters & highlights editor.

5. **Server-Authoritative Watch Parties (`server.ts` & `src/services/watchPartyModel.ts`)**:
   - Cryptographic `hostToken` generation stored on server and never disclosed to audience.
   - Monotonic sequence numbers (`seq`) and server timestamps to prevent command replay and stale packet race conditions.
   - Live chat, emoji reaction bursts, participant tracking, and note creation with ownership verification.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Motion
- **Backend**: Express 4, Node.js (`tsx`)
- **Build System**: Vite 8
- **Testing**: Node's built-in `node:test` and `node:assert/strict`

---

## 🧪 Running Tests

Run the full suite of unit tests:
```bash
npx tsx --test src/services/__tests__/*.test.ts
```

Run TypeScript compilation check:
```bash
npm run lint
```

---

## 📦 Getting Started

1. Install dependencies:
```bash
npm install
```

2. Start the development server (runs full-stack Express + Vite on port 3000):
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
npm start
```

4. Open in browser: `http://localhost:3000`
