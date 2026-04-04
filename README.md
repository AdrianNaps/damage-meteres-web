# Details Bridge

A local real-time combat meter for World of Warcraft. Reads `WoWCombatLog` files as they're written and streams live DPS/HPS data to a browser — no addons, no uploads.

## Requirements

- Node.js 18+
- World of Warcraft retail with **Advanced Combat Logging** enabled

## Setup

**1. Enable Advanced Combat Logging in WoW**

Game Menu → System → Network → check **Advanced Combat Logging**. Without this, many events won't be written to the log.

**2. Configure the log path**

Copy `.env.example` to `.env` and set `LOGS_DIR` to your WoW `Logs/` directory:

```env
LOGS_DIR=C:/Program Files (x86)/World of Warcraft/_retail_/Logs
WS_PORT=3001
MAX_SEGMENTS=10
```

This is the **#1 setup failure point** — the path must point to the `Logs/` folder, not the log file itself.

**3. Install dependencies**

From the project root:

```bash
npm install
npm install --prefix client
```

## Running

Both servers can be started from the project root. Open two terminals:

```bash
# Terminal 1 — backend
npm run dev:server

# Terminal 2 — frontend
npm run dev:client
```

Then open `http://localhost:5173`.

The server will auto-detect the most recent `WoWCombatLog-*.txt` in your `Logs/` directory (if it's less than 24 hours old) and begin tailing it. When WoW creates a new log file (e.g. on dungeon entry), the server switches to it automatically.

## Usage

- **Meter** — shows all players ranked by DPS or HPS for the current encounter. Toggle between Damage and Healing with the buttons at the top.
- **Breakdown** — click any player row to see a per-spell breakdown with hits, crit%, min/max, and absorbed amounts. Press Escape or click the backdrop to close.
- **Segment tabs** — past encounters are saved (up to 10) and accessible via the tab strip. Click any tab to review that pull's data.
- **Status indicator** — the dot in the top-left shows WebSocket connection state (green = connected).

## How it works

```
WoWCombatLog.txt → File Watcher → Parser → State Machine → Aggregator
                                                                ↓
                                               WebSocket broadcast (~1/sec)
                                                                ↓
                                              React frontend (Zustand store)
```

- The file watcher tails the active log file in 64KB chunks, handling mid-flush partial lines and file truncation.
- The parser converts raw CSV log lines into typed events. Damage and heal suffixes are parsed from the **end** of each line rather than absolute field positions, making it resilient to Blizzard adding fields to the advanced info block.
- The state machine tracks encounter boundaries (`ENCOUNTER_START` / `ENCOUNTER_END`) and routes events to the aggregator. Events outside encounters are captured in an "Open World / Trash" segment.
- DPS/HPS is calculated from the timestamp of the first event to the last event in each segment — not wall clock time — so it stays stable when you're not in combat.
- The WebSocket server broadcasts a full state snapshot once per second. The frontend never pulls; the server always pushes.

## Project structure

```
├── server/
│   ├── index.ts          # entry point
│   ├── watcher.ts        # file tail with offset tracking
│   ├── parser.ts         # log line → ParsedEvent
│   ├── stateMachine.ts   # encounter lifecycle
│   ├── aggregator.ts     # events → data model
│   ├── store.ts          # segment ring buffer + snapshot serialization
│   ├── wsServer.ts       # WebSocket server + broadcast loop
│   └── types.ts          # shared server types
├── client/
│   └── src/
│       ├── App.tsx
│       ├── store.ts      # Zustand state
│       ├── ws.ts         # WebSocket client singleton
│       ├── types.ts      # shared client types
│       └── components/
│           ├── EncounterHeader.tsx
│           ├── SegmentTabs.tsx
│           ├── MeterView.tsx
│           ├── PlayerRow.tsx
│           ├── BreakdownPanel.tsx
│           └── SpellTable.tsx
├── .env.example
└── package.json
```
