# VoidFlippr

> Renamed from FlipGrid. Win condition: "any uniform color" (was "all white").

A single-page Lights Out-style puzzle game with a daily leaderboard.

Tap a tile to flip it and its 8 neighbours. Turn all tiles the same colour to win.
A new daily puzzle is seeded from the UTC date, so every player worldwide gets
the same puzzle and the leaderboard resets at midnight.

---

## Features

- **Three difficulties** (Easy / Medium / Hard) plus custom flip counts 1-100
- **Daily puzzle** - same seed worldwide, top-10 leaderboard per UTC day
- **Two-slot leaderboard per player** - `First` (locked) + `Best` (auto-tracked)
- **Theme** - light / dark, respects `prefers-color-scheme`, persists in localStorage
- **Custom tile colours** - pick front and back colours in Settings
- **Sound effects** - click + win sounds, can be muted
- **Tutorial** - interactive 3x3 demo using the same flip logic as the real game
- **Shareable puzzles** - `?seed=12345` auto-loads a specific seed
- **Mobile-friendly** - works on phones, dark mode by default
- **Self-cleaning leaderboard** - files older than 7 days are pruned automatically

---

## Requirements

- **Node.js 18 or newer.** That is the only requirement for running the server.
- The server has **no runtime dependencies** - `npm install` is only needed if
  you want to rebuild the frontend bundle.

---

## Quick start

```bash
npm install                # optional: only needed to rebuild dist/
npm run build:prod         # optional: bundle the frontend into dist/
npm start                  # serves on http://localhost:9865
```

Then open <http://localhost:9865/>.

Other devices on your LAN can reach it at `http://<your-LAN-IP>:9865/`.

Convenience scripts (macOS/Linux):

```bash
./run.sh              # local server, rebuilds if src/ is newer
./run.sh 9000         # custom port
./build.sh            # dev build
./build.sh --prod     # production build
```

---

## Deploying to any host

The app is a plain Node.js HTTP server with no runtime dependencies, so moving
it to a new host is a file copy.

```bash
# On the build machine
npm install
npm run build:prod
```

Copy these to the target host:

```
server.js
server/
dist/
package.json
404.html
```

Then on the target host:

```bash
node server.js
```

Or via systemd, using the included unit file:

```bash
sudo cp ops/systemd/voidflippr.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now voidflippr
```

See [`ops/RUNBOOK.md`](ops/RUNBOOK.md) for the full topology, nginx and
Cloudflare setup, and recovery procedures.

### Configuration

Everything is environment-driven, so no code changes are needed per host.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `9865` | TCP port to listen on |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` behind a reverse proxy |
| `LEADERBOARD_DIR` | `./leaderboard` | Where daily leaderboard files are stored |
| `LEADERBOARD_RETENTION_DAYS` | `7` | Days of history to keep before pruning |
| `MAX_BODY_BYTES` | `16384` | Max accepted score submission size |
| `VERBOSE` | off | Log every request, not just errors |

---

## How the game works

### Board representation

A 9x9 grid. Each cell is a boolean:

- `false` = front colour (default white)
- `true` = back colour (default dark)

### Flipping a tile

Clicking a tile flips it and its 8 neighbours (including diagonals). A corner
click affects 4 tiles, an edge click 6, a centre click all 9.

```js
const FLIP_DIRECTIONS = [
    [0, 0], [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]
];

function flipTiles(board, row, col) {
    for (const [dr, dc] of FLIP_DIRECTIONS) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < board.length && nc >= 0 && nc < board.length) {
            board[nr][nc] = !board[nr][nc];
        }
    }
}
```

### Puzzle generation

A puzzle starts from a solved (all-front) board and applies N random flips.
N is the difficulty (10 / 20 / 30) or the player's custom value.

```js
function generatePuzzle(size, steps, seedValue) {
    const board = Array(size).fill(null).map(() => Array(size).fill(false));
    for (let i = 0; i < steps; i++) {
        const r = Math.floor(seededRandom(s++) * size);
        const c = Math.floor(seededRandom(s++) * size);
        flipTiles(board, r, c);
    }
    return board;
}
```

The RNG is seeded, so the same seed always produces the same puzzle. The
"Generator" stat in the UI is the number of flips used to generate the puzzle,
not the optimal solution count.

### Win condition

All tiles must share the same colour - either all front or all back. The first
tile's colour is the target; every other tile must match. Checked after every
click.

---

## Project layout

```
VoidFlippr/
├── server.js                  Entry point - starts the HTTP server
├── server/                    Server modules
│   ├── config.js              Environment-driven configuration
│   ├── daily.js               UTC day key, timestamp, seed
│   ├── index.js               HTTP server + routing
│   ├── leaderboard.js         Per-day JSON storage
│   ├── static.js              Safe static file serving
│   └── validate.js            Submission validation
│
├── src/                       Frontend source - what you edit
│   ├── index.html             Thin HTML shell
│   ├── css/                   10 stylesheets
│   └── js/                    11 ES modules
│
├── dist/                      Build output (gitignored) - what the server serves
│   ├── index.html
│   ├── css/style.css          Concatenated stylesheet
│   ├── js/main.js             Bundled + minified by esbuild
│   └── 404.html               Branded not-found page
│
├── test/                      Automated tests (node:test)
├── leaderboard/               Per-day data, one JSON file per UTC day
│
├── build.mjs                  Build script
├── package.json
├── README.md                  This file
│
├── build.sh / run.sh          Local convenience wrappers
├── sync.sh / deploy.sh        Deployment helpers
│
├── 404.html                   Branded not-found page (source copy)
│
└── ops/                       Production deployment artifacts
    ├── nginx/                 voidflippr.conf, -lan, -internal, cloudflare-ips, realip
    ├── systemd/               voidflippr.service
    ├── cloudflared/           config.yml + cloudflare-dns.md
    └── RUNBOOK.md             Day-to-day ops + recovery procedures
```

---

## Source files

### `src/css/` - split by concern

| File | What it styles |
|---|---|
| `theme.css` | CSS variables, light + dark themes |
| `base.css` | Reset, body, buttons, header icons |
| `screens.css` | Home / difficulty / settings / game screen layouts |
| `board.css` | Game board grid + tiles + flip animation |
| `modals.css` | Modal shell, win modal, modal buttons |
| `tutorial.css` | Tutorial overlay + interactive demo |
| `identity.css` | First-visit name + GUID modal |
| `leaderboard.css` | Home-screen leaderboard + slot badges |
| `submit.css` | Win-modal submit section + success card |
| `toast.css` | Bottom-centre toast notification |

### `src/js/` - ES modules

| File | Responsibility |
|---|---|
| `main.js` | Entry point. Wires inline `onclick=` handlers to `window.*` and runs init. |
| `util.js` | `formatElapsed`, `formatBestTime`, `escapeHtml`, `seededRandom`, `generateGuid`. |
| `state.js` | Shared state object + localStorage helpers. |
| `audio.js` | Web Audio context + click/win sounds. All errors swallowed. |
| `identity.js` | First-visit name + GUID prompt, localStorage persistence. |
| `daily.js` | Fetches `/daily-seed`, exposes `getSeedFromURL()`. |
| `leaderboard.js` | Fetches + renders the top-10, submits scores. |
| `game.js` | Board generation, tile clicks, timer, win detection, end-game flow. |
| `ui.js` | Screen navigation, theme toggle, settings, submit UI rendering. |
| `tutorial.js` | Tutorial overlay + interactive 3x3 demo. |
| `toast.js` | Bottom-centre toast helper. |

### Module dependency graph

```
main -> util, state, audio, identity, daily, leaderboard, game, ui, tutorial, toast
ui   -> state, util, toast, leaderboard
game -> state, util, audio, ui, daily, leaderboard
audio -> state
identity -> state, util, toast
daily -> state
leaderboard -> state, util
tutorial -> (none)
toast -> (none)
state -> util
util -> (none)
```

No circular dependencies. ES modules hoist bindings, so the inline
`onclick="foo()"` lookups in `index.html` are wired up by `main.js` assigning
functions to `window.*` after the imports resolve.

---

## Build system

```bash
npm run build          # dev build (readable output)
npm run build:prod     # production build (minified)
```

`build.mjs` does three things:

1. **esbuild (programmatic API)** - bundles `src/js/main.js` into
   `dist/js/main.js` as ESM, target es2020, minified in production.
2. **CSS concatenation** - reads `src/css/*.css` in a fixed order (theme first,
   toast last), prepends section banner comments, writes `dist/css/style.css`.
3. **HTML rewrite** - strips the per-file `<link>` tags, inserts the single
   bundled stylesheet, and points the module script at the bundle.

It then removes the individual source modules and stylesheets from `dist/`, so
the deployed folder contains only what is needed to serve the game.

The CSS order is fixed in `build.mjs` because concatenation does not preserve
dependency order - the variables in `theme.css` must be defined before any
other file references them.

If esbuild is not installed, the build copies `src/` as-is and the server runs
straight from the source tree. The game still works; it just is not bundled or
minified.

---

## Server API

All responses are JSON with `Cache-Control: no-store`.

### `GET /daily-seed`

```json
{ "date": "20261026", "iso": "2026-10-26T12:07:00Z", "seed": 120261026 }
```

The seed is `parseInt('1' + YYYYMMDD)`, so it is identical for every player on
a given UTC day.

### `GET /daily-leaderboard`

Optional `?guid=XXXX` returns the player's own slots alongside the top 10.

```json
{
  "date": "20261026",
  "total": 802,
  "top10": [{ "rank": 1, "name": "Alice", "guid": "ABCDEFGH", "timeMs": 19607, "slot": "best" }],
  "me": {
    "guid": "ABCDEFGH",
    "first": { "timeMs": 25430, "rank": 69, "submittedAt": "2026-10-26T10:15:30Z" },
    "best":  { "timeMs": 19607, "rank": 3,  "submittedAt": "2026-10-26T10:42:11Z" }
  }
}
```

### `POST /daily-submit`

```json
{ "guid": "ABCDEFGH", "name": "Alice", "seed": 120261026, "timeMs": 19607, "slotHint": "best" }
```

Returns `{ ok, accepted, improved, rank, total, slot, timeMs }`, or
`{ ok: false, reason }` with a 400 status.

### `GET /healthz`

Returns `{ "ok": true, "uptime": 123 }`. Useful for load balancer checks.

---

## Leaderboard storage

One file per UTC day: `leaderboard/YYYYMMDD.json`.

```json
{
  "entries": [
    { "guid": "ABCDEFGH", "name": "Alice", "timeMs": 25430, "submittedAt": "2026-10-26T10:15:30Z", "slot": "first" },
    { "guid": "ABCDEFGH", "name": "Alice", "timeMs": 19607, "submittedAt": "2026-10-26T10:42:11Z", "slot": "best" }
  ]
}
```

**Two slots per player per day:**

- `first` - locked in on the player's first submission. Never updated.
- `best` - created on the second submission. Updated only when the new time is
  faster; the previous best entry is deleted, so the store stays self-cleaning.

**Validation on submit:**

- `timeMs` in `[1000, 1800000]` (1 second to 30 minutes)
- `seed` must equal today's seed (rejects cross-midnight submissions)
- `name` matches `[A-Za-z0-9 _-]{1,20}`
- `guid` matches `[A-Z2-9]{8}`

**Retention** - files older than 7 days are pruned opportunistically on each
leaderboard and submit request.

**Write safety** - every write goes to a temporary file and is then renamed,
so a crash mid-write cannot corrupt a day's data. All mutations are serialised
through a promise chain, so concurrent submissions cannot interleave.

---

## Identity

Players pick a display name on first visit and receive an auto-generated
8-character GUID (alphabet `A-Z2-9`, no `0/O/1/I` confusion). Both are stored
in `localStorage`. The GUID is the primary key - display names are not unique.

GUIDs use `crypto.getRandomValues` (Web Crypto API) when available, falling
back to `Math.random`.

---

## Daily puzzle flow

```
[Player opens /daily-seed]              <- server returns {date, iso, seed}
[Player finishes the puzzle]
[Player clicks Submit - 00:25.43]
  -> POST /daily-submit {guid, name, seed, timeMs, slotHint: "first"}
  -> Server validates, appends {slot: "first"} to leaderboard/YYYYMMDD.json
  -> Server returns {ok, rank: 69, total: 802, slot: "first"}
  -> Client shows "First Run Submitted - #69 of 802"
[Player re-attempts and is faster]
  -> POST /daily-submit {..., slotHint: "best"}
  -> Server creates or improves the {slot: "best"} entry
  -> Client shows "Best Updated - #3 of 803"
```

---

## UI flow

```
                   +----------------+
                   |    Identity    |  (first visit only)
                   |     modal      |
                   +-------+--------+
                           v
       +----------------------------------+
       |  Home: Start New / Daily / ...   |--> Daily -> daily puzzle
       |  Daily Leaderboard (top 10)     |--> Start New -> difficulty select
       +---------------+------------------+
                       v
       +----------------------------------+
       |  Game: 9x9 grid, stats, timer   |
       +-------+------------------+-------+
               v                  v
         [tile click]        [Home button]
               |                  |
               v                  +--> Home (resets state)
       +----------------------------------+
       |  Win modal:                      |
       |    Time / Moves / Generator      |
       |    [Daily: rank + submit]        |
       |    [Play Again / New / Home]     |
       +----------------------------------+
```

---

## Browser support

Modern evergreen browsers (Chrome 88+, Firefox 85+, Safari 14+). The build
targets es2020, so there is no IE support.

- Uses `crypto.getRandomValues` with a `Math.random` fallback
- Uses the Web Audio API with graceful failure
- Works on iOS Safari 14+ and Chrome Android

---

## Tests

```bash
npm test
```

Covers the submission validation rules, the daily seed maths, and the full HTTP
API - including the leaderboard slot logic, path-traversal protection and the
fact that source files are never served.

---

## License

Personal project. Use freely.