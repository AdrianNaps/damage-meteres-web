# Details Bridge

A local real-time combat meter for World of Warcraft. Tails `WoWCombatLog` files as they're written and renders a live damage/healing meter in a desktop app (Electron) or a browser.

## Requirements

- Windows 10/11
- World of Warcraft retail with **Advanced Combat Logging** enabled
- Node.js 20+ *(only if building from source)*

**In-game setup:** Game Menu → System → Network → check **Advanced Combat Logging**. Without this, many events won't be written to the log. To begin generating logs each session, type `/combatlog` before the key or raid begins — or install [Simple Combat Logger](https://www.curseforge.com/wow/addons/simplecombatlogger) to automate it.

## Running

There are two ways to run Details Bridge. The desktop app is the primary path; the headless mode exists for tunnel workflows.

### Desktop app (recommended)

```bash
npm install
npm run dev:electron        # one-command dev loop (Vite + Electron)
```

To produce a Windows installer:

```bash
npm run package             # builds NSIS installer into release/
```

The installer is per-user (no admin rights, no UAC) and writes its config to `%APPDATA%/details-bridge/`. On launch the app reads the default WoW retail logs path and starts tailing immediately — no `.env`, no manual configuration. If the path is wrong, click the gear icon in the header to pick a different folder; the watcher hot-swaps without an app restart.

> **Note:** Builds are unsigned, so Windows SmartScreen will warn on first launch. Click *More info* → *Run anyway*.

### Headless / browser mode

For the original two-process workflow (useful when you want to share the meter via a tunnel):

```bash
cp .env.example .env        # set LOGS_DIR if it differs from the default
npm run dev:server          # backend on :3001
npm run dev:client          # frontend on :5173
```

Open `http://localhost:5173`. Or, for production:

```bash
npm run build:client
npm start                   # serves client/dist + WS on :3001
```

Tunnel port 3001 with any service to share the meter externally. The WebSocket reconnects through the same host — no hardcoded addresses.

## Usage

- **Meter** — all players ranked by DPS or HPS for the current encounter. Toggle Damage / Healing at the top.
- **Breakdown** — click any player row for a per-spell breakdown with hits, crit%, min/max, and absorbed amounts. Esc or backdrop click to close.
- **Segment tabs** — the last 10 encounters (or key runs) are kept and accessible via the tab strip.
- **Settings** — gear icon in the header (desktop app only) opens a folder picker for the WoW logs directory.
- **Status indicator** — the dot top-left shows WebSocket connection state (green = connected).

## How it works

```
WoWCombatLog.txt → watcher → parser → state machine → segment store
                                                            │
                                              WebSocket broadcast (~1/sec)
                                                            │
                                            React frontend (Zustand store)
```

- **Watcher** tails the active log file in 64KB chunks, handling mid-flush partial lines and file truncation.
- **Parser** converts raw CSV log lines into typed events. Damage and heal suffixes are parsed from the **end** of each line rather than absolute field positions, so the parser stays resilient to Blizzard adding fields to the advanced-info block.
- **State machine** tracks encounter boundaries (`ENCOUNTER_START` / `ENCOUNTER_END`, `CHALLENGE_MODE_START` / `_END`) and routes events. Mythic+ runs are grouped: trash → boss → trash with carry-over of player spec/name across segments.
- **DPS/HPS** is computed from the first event to the last event in each segment, not wall-clock time, so the number stays stable when out of combat.
- **WebSocket** broadcasts a full state snapshot once per second. The frontend never pulls; the server always pushes.

In the desktop app, the WebSocket binds to `127.0.0.1` on an ephemeral port and the renderer learns the port via a preload bridge. In headless mode the same WS server attaches to the HTTP server on port 3001.

## Project structure

```
├── electron/                ← Electron main process (desktop app)
│   ├── main.ts              # BrowserWindow + IPC
│   ├── backend.ts           # owns watcher / store / state machine / WSS
│   ├── settings.ts          # electron-store wrapper (logsDir, window bounds)
│   ├── preload.cjs          # contextBridge → window.api
│   └── tsconfig.json        # compiles electron/ + server/ → dist-electron/
├── server/                  ← shared library (used by both entry points)
│   ├── index.ts             # headless dev entry (HTTP + WS on :3001)
│   ├── watcher.ts           # file tail with offset tracking
│   ├── parser.ts            # log line → ParsedEvent
│   ├── stateMachine.ts      # encounter / key-run lifecycle
│   ├── aggregator.ts        # events → data model
│   ├── store.ts             # segment ring buffer + snapshot serialization
│   ├── wsServer.ts          # attachWsHandlers(wss, store, machine)
│   ├── iconResolver.ts      # spell-icon cache (Wowhead lookups)
│   └── types.ts
├── client/                  ← React + Vite renderer (shared)
│   └── src/
│       ├── App.tsx
│       ├── store.ts         # Zustand state
│       ├── ws.ts            # WebSocket client (electron preload aware)
│       ├── electron.d.ts    # window.api type
│       └── components/
├── build/                   ← installer assets (icon.ico) — TODO
├── .env.example             # headless mode only
└── package.json
```

## Known limitations

- **Windows only.** No mac/Linux builds.
- **Unsigned installer.** SmartScreen warns on first launch.
- **Spell icons require internet.** The first time the app sees an unknown spell ID it fetches the icon name from Wowhead and caches it in `%APPDATA%/details-bridge/spell-icons.json`. Offline launches still work but unrecognized spells render with broken `<img>` tags. The installer ships with ~220 pre-resolved icons.
- **No auto-update.** New versions need a manual reinstall.
