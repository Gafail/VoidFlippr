# VoidFlippr - Operations Runbook

A quick reference for deploying, operating, and recovering VoidFlippr.

## Topology

```
   Internet --> Cloudflare (TLS + WAF)
            --> cloudflared tunnel
            --> nginx (:80 public, :8080 LAN, :127.0.0.1:8080 internal)
            --> Node.js server (127.0.0.1:9865 only)
            --> SQLite database at DATA_DIR
```

The Node server binds to `127.0.0.1` only - it is never reachable without
going through nginx. The Cloudflare tunnel terminates TLS upstream.

## Requirements

- Node.js 22.5 or newer (`node --version`)
- nginx
- optionally `cloudflared` for a tunnel

There are no runtime npm dependencies. `esbuild` is only needed if you want to
rebuild the frontend on the server.

## First-time setup

```bash
# 1. Create the voidflippr system user (once)
sudo useradd -r -m -d /opt/voidflippr -s /usr/sbin/nologin voidflippr

# 2. Sync source into a deploy tree + deploy
./sync.sh
./deploy.sh                  # sudo required

# 3. Bootstrap the Cloudflare tunnel
sudo cloudflared tunnel login
sudo cloudflared tunnel create voidflippr
# Edit ops/cloudflared/config.yml with the new UUID + credentials path
sudo cp ops/cloudflared/config.yml /etc/cloudflared/config.yml
sudo systemctl enable --now cloudflared
```

## Day-to-day commands

| What | Command |
|---|---|
| View server logs | `sudo journalctl -u voidflippr -f` |
| Restart server | `sudo systemctl restart voidflippr` |
| Server status | `sudo systemctl status voidflippr` |
| Tail nginx access | `sudo tail -f /var/log/nginx/voidflippr.access.log` |
| Tail nginx errors | `sudo tail -f /var/log/nginx/voidflippr.error.log` |
| Smoke test the stack | `curl -s http://127.0.0.1:8080/daily-seed` |
| Health check | `curl -s http://127.0.0.1:9865/healthz` |
| Inspect the leaderboard | `sqlite3 /opt/voidflippr/data/leaderboard.db "SELECT * FROM entries"` |
| Inspect a past day | same query, filtered by `WHERE day = 'YYYYMMDD'` |
| Check the storage backend | `curl -s http://127.0.0.1:9865/healthz` (returns `storage`) |
| Local dev run | `./run.sh` |

## Deploying a change

```bash
# Locally
./sync.sh                # writes ./deploy/

# On the server
./deploy.sh              # rsyncs ./deploy/ -> /opt/voidflippr/, reloads systemd + nginx
```

## Running on any other host

The server is a plain Node.js app with no runtime dependencies, so it runs
anywhere Node.js 22.5+ is available:

```bash
# Build the frontend once
npm install
npm run build:prod

# Copy server.js, server/, shared/, dist/, public/ and 404.html to the host
node server.js
```

### Storage - read this before going live

The leaderboard lives in a SQLite database at `DATA_DIR` (default
`/opt/voidflippr/data` on a VPS). That directory also holds the identity
signing secret.

**On a host with an ephemeral filesystem** (most container platforms and PaaS
free tiers), the disk contents are discarded on every deploy or restart, so
the scores would be lost. Point `DATA_DIR` at a mounted volume:

| Host | How |
|---|---|
| Docker | `docker run -v voidflippr-data:/data -e DATA_DIR=/data ...` |
| Fly.io | `fly volumes create voidflippr_data` then mount at `/data` |
| Render | attach a disk and mount it at `/data` |
| Railway | add a volume mounted at `/data` |
| VPS | the default path is already persistent |

To share one leaderboard between several instances, set the same
`IDENTITY_SECRET` on all of them so they accept each other's tokens.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `9865` | TCP port to listen on |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Database and identity secret location |
| `STORAGE_BACKEND` | `auto` | `auto`, `sqlite` or `json` |
| `LEADERBOARD_RETENTION_DAYS` | `7` | Days of history to keep |
| `IDENTITY_SECRET` | generated | Token signing secret |
| `ALLOWED_ORIGINS` | empty | Extra origins allowed to call the API |
| `TRUST_PROXY` | off | Trust `X-Forwarded-For` for client IPs |
| `MIN_MS_PER_MOVE` | `1200` | Assumed human pace per move |
| `RATE_LIMIT_SUBMIT` | `60` | Submissions per IP per window |
| `RATE_LIMIT_SUBMIT_GUID` | `20` | Submissions per player per window |
| `RATE_LIMIT_IDENTITY` | `30` | Registrations per IP per window |
| `RATE_LIMIT_WINDOW_SEC` | `60` | Rate limit window in seconds |

When the server sits behind nginx, set `TRUST_PROXY=1` so rate limits are
applied per real client rather than per proxy.

## Recovery

**Server won't start**:
1. `sudo journalctl -u voidflippr -n 50` - read the error.
2. Common: port 9865 in use. `sudo lsof -iTCP:9865 -sTCP:LISTEN -P -n`.
3. Missing `node`. `which node` - install Node.js 22.5+.
4. Node older than 22.5: `node:sqlite` is unavailable, so the server falls
   back to the JSON backend automatically. Set `STORAGE_BACKEND=json`
   explicitly to silence the warning.

**Leaderboard data corruption**:
1. `sudo systemctl stop voidflippr`
2. `sudo mv /opt/voidflippr/data/leaderboard.db /opt/voidflippr/data/leaderboard.db.bak`
3. `sudo systemctl start voidflippr` - the server creates a fresh database.

**Everyone's score disappeared after a deploy**:
The data directory was on an ephemeral filesystem. Move `DATA_DIR` to a
persistent volume and restore from a backup if you have one.

**Players suddenly cannot submit**:
1. `curl -s http://127.0.0.1:9865/daily-seed` - is the server up?
2. Look for `403 unknown identity` in the logs. That means the identity
   secret changed, which happens if `DATA_DIR` was reset. Players will get a
   new identity on their next visit, but their old entries stay in the
   database under the old GUID.
3. Look for `429 too many submissions` - the rate limit was hit. Raise
   `RATE_LIMIT_SUBMIT` if the limit is too low for your audience.

**nginx config broken after deploy**:
1. `sudo nginx -t` - see what failed.
2. Fix or restore `ops/nginx/` from a known-good state, then re-deploy.

**Cloudflare tunnel down**:
1. `sudo systemctl status cloudflared`
2. `sudo journalctl -u cloudflared -n 50`
3. If the credentials file is missing or rotated, re-run `cloudflared tunnel login`.

## Files at a glance

```
/opt/voidflippr/
  server.js                Node entry point
  server/                  Server modules
    config.js              Environment-driven config
    daily.js               UTC day key + seed
    identity.js            Server-issued identities + tokens
    index.js               HTTP server + routing
    ratelimit.js           Sliding-window limiter
    static.js              Safe static file serving
    store.js               SQLite / JSON storage
    validate.js            Submission validation
  shared/
    puzzle.js              Board generation + minimum-move solver
  public/                  Icons, manifest, robots.txt
  dist/                    Built frontend (served)
  404.html                 Branded not-found page
  run.sh
  package.json
  data/                    Leaderboard database + identity secret
  ops/
    nginx/                 voidflippr.conf, -lan, -internal, cloudflare-ips, realip
    systemd/               voidflippr.service
    cloudflared/           config.yml + cloudflare-dns.md

/etc/nginx/sites-enabled/
  voidflippr            (public, :80)
  voidflippr-lan        (LAN, :8080)
  voidflippr-internal   (127.0.0.1:8080)

/etc/systemd/system/
  voidflippr.service
  cloudflared.service
```