# VoidFlippr - Operations Runbook

A quick reference for deploying, operating, and recovering VoidFlippr.

## Topology

```
   Internet --> Cloudflare (TLS + WAF)
            --> cloudflared tunnel
            --> nginx (:80 public, :8080 LAN, :127.0.0.1:8080 internal)
            --> Node.js server (127.0.0.1:9865 only)
            --> leaderboard/YYYYMMDD.json on disk
```

The Node server binds to `127.0.0.1` only - it is never reachable without
going through nginx. The Cloudflare tunnel terminates TLS upstream.

## Requirements

- Node.js 18 or newer (`node --version`)
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
| Inspect leaderboard | `cat /opt/voidflippr/leaderboard/$(date -u +%Y%m%d).json` |
| Inspect any past day | `cat /opt/voidflippr/leaderboard/YYYYMMDD.json` (7-day retention) |
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
anywhere Node.js 18+ is available:

```bash
# Build the frontend once
npm install
npm run build:prod

# Copy server.js, server/, dist/, package.json and 404.html to the host
node server.js
```

Configure it with environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `9865` | TCP port to listen on |
| `HOST` | `0.0.0.0` | Bind address (use `127.0.0.1` behind a reverse proxy) |
| `LEADERBOARD_DIR` | `./leaderboard` | Where daily leaderboard files are stored |
| `LEADERBOARD_RETENTION_DAYS` | `7` | Days of history to keep |
| `MAX_BODY_BYTES` | `16384` | Max accepted score submission size |
| `VERBOSE` | off | Log every request |

## Recovery

**Server won't start**:
1. `sudo journalctl -u voidflippr -n 50` - read the error.
2. Common: port 9865 in use. `sudo lsof -iTCP:9865 -sTCP:LISTEN -P -n`.
3. Missing `node`. `which node` - install Node.js 18+.
4. Missing leaderboard directory - the server creates it on first write.

**Leaderboard data corruption**:
1. `sudo systemctl stop voidflippr`
2. `sudo mv /opt/voidflippr/leaderboard /opt/voidflippr/leaderboard.bak`
3. `sudo systemctl start voidflippr` - server creates a fresh empty `leaderboard/` directory.

**nginx config broken after deploy**:
1. `sudo nginx -t` - see what failed.
2. Fix or restore `ops/nginx/` from a known-good state, then re-deploy.

**Cloudflare tunnel down**:
1. `sudo systemctl status cloudflared`
2. `sudo journalctl -u cloudflared -n 50`
3. If the credentials file is missing/rotated, re-run `cloudflared tunnel login`.

## Files at a glance

```
/opt/voidflippr/
  index.html               (in dist/)
  server.js                Node entry point
  server/                  Server modules
    config.js              Environment-driven config
    daily.js               UTC day key + seed
    index.js               HTTP server + routing
    leaderboard.js         Per-day JSON storage
    static.js              Safe static file serving
    validate.js            Submission validation
  404.html                 Branded not-found page
  run.sh
  package.json
  dist/                    Built frontend (served)
  leaderboard/             Per-day data (created at runtime)
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