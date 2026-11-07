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
- **Server-issued identities** - signed tokens, so scores cannot be forged
- **Anti-cheat time floor** - the true minimum move count is computed server-side
- **Theme** - light / dark, respects `prefers-color-scheme`, persists in localStorage
- **Custom tile colours** - pick front and back colours in Settings
- **Sound effects** - click + win sounds, can be muted
- **Tutorial** - interactive 3x3 demo using the same flip logic as the real game
- **Shareable puzzles** - `?seed=12345` auto-loads a specific seed
- **Installable** - PWA manifest, icons, and a branded 404 page
- **Mobile-friendly** - works on phones, dark mode by default
- **Self-cleaning leaderboard** - files older than 7 days are pruned automatically

---

## Requirements

- **Node.js 22.5 or newer.** That is the only requirement for running the server.
- The server has **no runtime dependencies**. `npm install` is only needed if
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
shared/
dist/
public/
package.json
404.html
```

Then on the target host:

```bash
node server.js
```

Or with Docker, which is the most portable option:

```bash
docker build -t voidflippr .
docker run -p 9865:9865 -v voidflippr-data:/data voidflippr
```

The `-v` volume is **required** to keep scores. Without it the database lives
inside the container and is lost when the container is replaced.

### Storage

The leaderboard lives in a **SQLite database** (`data/leaderboard.db`) by
default, using the built-in `node:sqlite` module - no npm dependency. A
JSON-file backend is available as a fallback:

```bash
STORAGE_BACKEND=json npm start
```

Both backends keep one entry per player per day and are covered by the same
test suite.

> **Persistent storage is the one thing you must get right.** Hosts with an
> ephemeral filesystem (most container platforms and PaaS free tiers) discard
> their disk contents on every deploy or restart. Point `DATA_DIR` at a
> mounted volume so the scores survive.

### Configuration

Everything is environment-driven, so no code changes are needed per host.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `9865` | TCP port to listen on |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` behind a reverse proxy |
| `DATA_DIR` | `./data` | Where the leaderboard database and identity secret live |
| `STORAGE_BACKEND` | `auto` | `auto`, `sqlite` or `json` |
| `LEADERBOARD_RETENTION_DAYS` | `7` | Days of history to keep before pruning |
| `MAX_BODY_BYTES` | `16384` | Max accepted score submission size |
| `VERBOSE` | off | Log every request, not just errors |
| `IDENTITY_SECRET` | generated | Secret used to sign identity tokens |
| `ALLOWED_ORIGINS` | empty | Extra origins allowed to call the API |
| `TRUST_PROXY` | off | Trust `X-Forwarded-For` for client IP detection |
| `MIN_MS_PER_MOVE` | `500` | Milliseconds per move assumed by the time floor |
| `MIN_TIME_MS` | `1000` | Absolute minimum accepted time |
| `MAX_TIME_MS` | `1800000` | Absolute maximum accepted time |
| `RATE_LIMIT_SUBMIT` | `60` | Submissions allowed per IP per window |
| `RATE_LIMIT_SUBMIT_GUID` | `20` | Submissions allowed per player per window |
| `RATE_LIMIT_IDENTITY` | `30` | Registrations allowed per IP per window |
| `RATE_LIMIT_WINDOW_SEC` | `60` | Rate limit window in seconds |

`IDENTITY_SECRET` is generated and cached in `DATA_DIR` when unset. Set it
explicitly if you run more than one instance, so they accept each other's
tokens.

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
function generateBoard(size = BOARD_SIZE, steps = DAILY_STEPS, seed = 0) {
    const board = Array(size).fill(null).map(() => Array(size).fill(false));
    let s = seed;
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
│   ├── identity.js            Server-issued identities + signed tokens
│   ├── index.js               HTTP server + routing
│   ├── ratelimit.js           Sliding-window rate limiter
│   ├── static.js              Safe static file serving
│   ├── store.js               Storage (SQLite + JSON backends)
│   └── validate.js            Submission validation
│
├── shared/                    Shared by the client and the server
│   └── puzzle.js              Board generation + minimum-move solver
│
├── src/                       Frontend source - what you edit
│   ├── index.html             Thin HTML shell
│   ├── css/                   11 stylesheets
│   └── js/                    12 ES modules
│
├── public/                    Site-root assets, copied into dist/
│   ├── favicon.ico, favicon-16.png, favicon-32.png
│   ├── apple-touch-icon.png, icon-192.png, icon-512.png
│   ├── manifest.webmanifest, robots.txt
│
├── tools/
│   └── generate-icons.mjs     Regenerates the icon set
│
├── test/                      Automated tests (node:test)
├── data/                      Leaderboard database (created at runtime)
│
├── dist/                      Build output (gitignored) - what the server serves
│
├── build.mjs                  Build script
├── Dockerfile                 Production image
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
| `kofi.css` | Ko-fi support button, themed to match the site |

### `src/js/` - ES modules

| File | Responsibility |
|---|---|
| `main.js` | Entry point. Wires inline `onclick=` handlers to `window.*` and runs init. |
| `util.js` | `formatElapsed`, `formatBestTime`, `escapeHtml`, `seededRandom`, `generateGuid`. |
| `state.js` | Shared state object + localStorage helpers. |
| `audio.js` | Web Audio context + click/win sounds. All errors swallowed. |
| `identity.js` | Requests a server-issued identity, prompts for a name. |
| `daily.js` | Fetches `/daily-seed`, exposes `getSeedFromURL()`. |
| `leaderboard.js` | Fetches + renders the top-10, submits scores. |
| `game.js` | Board generation, tile clicks, timer, win detection, end-game flow. |
| `ui.js` | Screen navigation, theme toggle, settings, submit UI rendering. |
| `tutorial.js` | Tutorial overlay + interactive 3x3 demo. |
| `toast.js` | Bottom-centre toast helper. |
| `kofi.js` | Loads the Ko-fi widget and renders it inline in the page. |

### `shared/puzzle.js` - used by both sides

The client and the server **must** agree on what a seed produces, otherwise the
server cannot judge a score. So both import this one module:

| Export | Purpose |
|---|---|
| `generateBoard(size, steps, seed)` | The board for a seed |
| `flipTiles(board, row, col)` | Flip a tile and its neighbours |
| `minimumMoves(board)` | Exact minimum clicks to solve a board |
| `dailyPuzzle(seed)` | Board plus its minimum move count |

`minimumMoves` solves the game exactly, as a linear system over GF(2):
Gaussian elimination finds the click set, and the null space is enumerated to
find the true minimum. It takes about 1 ms per board and the result is cached
per day.

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

It then removes the individual source modules and stylesheets from `dist/`, and
copies `public/` and the branded 404 page in, so the deployed folder contains
only what is needed to serve the game.

If esbuild is not installed, the build copies `src/` as-is and the server runs
straight from the source tree. The game still works; it just is not bundled or
minified.

---

## Server API

All responses are JSON with `Cache-Control: no-store`.

### `GET /daily-seed`

```json
{
  "date": "20261031",
  "iso": "2026-10-31T06:25:39Z",
  "seed": 120261031,
  "minMoves": 15
}
```

The seed is `parseInt('1' + YYYYMMDD)`, so it is identical for every player on
a given UTC day. `minMoves` is the true minimum number of clicks needed to
solve that day's board.

### `POST /daily-register`

Request:

```json
{ "name": "Alice" }
```

Response:

```json
{ "ok": true, "guid": "ZCLMSVLW", "token": "...", "name": "Alice" }
```

The GUID is issued by the server and the token is an HMAC over it. The client
stores both and sends the token back on every submission, so a hand-crafted
GUID is rejected.

### `GET /daily-leaderboard`

Optional `?guid=XXXX` returns the player's own slots alongside the top 10.

```json
{
  "date": "20261031",
  "total": 802,
  "top10": [{ "rank": 1, "name": "Alice", "guid": "ABCDEFGH", "timeMs": 19607, "slot": "best" }],
  "me": {
    "guid": "ABCDEFGH",
    "first": { "timeMs": 25430, "rank": 69, "submittedAt": "2026-10-31T10:15:30Z" },
    "best":  { "timeMs": 19607, "rank": 3,  "submittedAt": "2026-10-31T10:42:11Z" }
  }
}
```

### `POST /daily-submit`

```json
{
  "guid": "ABCDEFGH",
  "token": "...",
  "name": "Alice",
  "seed": 120261031,
  "timeMs": 19607,
  "moves": 15,
  "slotHint": "best"
}
```

Returns `{ ok, accepted, improved, rank, total, slot, timeMs }`, or
`{ ok: false, reason }` with a 400 status.

### `GET /healthz`

Returns `{ "ok": true, "uptime": 123, "storage": "sqlite" }`. Useful for load
balancer checks and the Docker healthcheck.

---

## Anti-cheat

A daily puzzle with a public seed is inherently solvable by anyone who cares
to write a solver - the board is the same for every player. These measures
make casual cheating pointless without pretending to stop a determined
attacker:

1. **Server-issued identities.** GUIDs come from the server and carry an HMAC
   token. Fabricating a GUID, or using someone else's, is rejected with 403.
   Without this, a bot could mint unlimited identities and take every slot.

2. **A minimum-move floor.** The server solves the day's board and knows the
   true minimum number of clicks. A submission claiming fewer moves than
   that is impossible and is rejected. A submission whose time is faster than
   `moves x MIN_MS_PER_MOVE` is also rejected - no human clicks that fast.
   The baseline is 500ms per move, so a 15-move board needs at least 7.5
   seconds. Raise it to make the leaderboard stricter, lower it to welcome
   speedrunners.

3. **Rate limits.** Submissions are limited per IP and per player; identity
   registration is limited per IP. A script cannot flood the board.

4. **Two slots per player.** `first` is locked on the first submission of the
   day and `best` only improves. One player can occupy at most two positions,
   so a single cheater cannot dominate the top ten.

**What this does not stop:** someone who solves the puzzle with a script and
then waits a realistic amount of time before submitting. The seed is public
by design, so a perfect solution is always computable. If that matters for
your leaderboard, run a private board instead of a seeded daily one.

---

## Leaderboard storage

One table (or one JSON file per day) with two entries per player.

```json
{
  "entries": [
    { "guid": "ABCDEFGH", "name": "Alice", "timeMs": 25430, "submittedAt": "2026-10-31T10:15:30Z", "slot": "first" },
    { "guid": "ABCDEFGH", "name": "Alice", "timeMs": 19607, "submittedAt": "2026-10-31T10:42:11Z", "slot": "best" }
  ]
}
```

**Two slots per player per day:**

- `first` - locked in on the player's first submission. Never updated.
- `best` - created on the second submission. Updated only when the new time is
  faster; the previous best entry is removed, so the store stays self-cleaning.

**Validation on submit:**

- `timeMs` in `[1000, 1800000]` (1 second to 30 minutes)
- `seed` must equal today's seed (rejects cross-midnight submissions)
- `name` matches `[A-Za-z0-9 _-]{1,20}`
- `guid` matches `[A-Z2-9]{8}` and must carry a valid server token
- `moves` must be at least the day's minimum move count
- `timeMs` must be consistent with `moves`

**Retention** - data older than 7 days is pruned on each leaderboard and
submit request.

**Write safety** - the SQLite backend writes each day inside a transaction;
the JSON backend writes to a temporary file and then renames it. All
mutations are serialised through a promise chain, so concurrent submissions
cannot interleave.

---

## Identity

Players pick a display name on first visit. The server then issues a GUID and
a signing token, both of which are stored in `localStorage`. The GUID is the
primary key - display names are not unique.

GUIDs are generated with `crypto.getRandomValues` on the server, so they are
cryptographically random. The alphabet avoids `0/O/1/I` confusion.

---

## Daily puzzle flow

```
[Player opens /daily-seed]              <- server returns {date, iso, seed, minMoves}
[Player finishes the puzzle]
[Player clicks Submit - 00:25.43]
  -> POST /daily-submit {guid, token, name, seed, timeMs, moves, slotHint: "first"}
  -> Server validates the token, the move count and the time
  -> Server appends {slot: "first"} to the leaderboard
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

- Uses the Web Audio API with graceful failure
- Works on iOS Safari 14+ and Chrome Android
- Installable as a PWA on platforms that support it

---

## Tests

```bash
npm test
```

Covers the submission validation rules, the daily seed maths, the exact
minimum-move solver (checked against a brute-force search), the storage
backends, the identity signing, the rate limiter, and the full HTTP API -
including path-traversal protection and the fact that source files are never
served.

The storage and API suites run against both backends:

```bash
TEST_STORAGE_BACKEND=json npm test
```

---

## License

MIT - see [LICENSE](LICENSE).