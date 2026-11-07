# VoidFlippr — Changes Handover

**Date:** 2026-11-08
**Requested:** integrate the Ko-fi button, deploy to the server, report IP + port.
**Status:** **complete** — integrated, built, deployed and live-verified. The
share-related blockers from the previous handover (§3) no longer apply; the
project now lives on a local ext4 filesystem. See §6.

---

## 1. Completed — Ko-fi widget integration

`src/index.html`, added just before `</body>` (line ~219):

```html
    <!-- Ko-fi support button -->
    <script type="text/javascript" src="https://storage.ko-fi.com/cdn/widget/Widget_2.js"></script>
    <script type="text/javascript">
        if (typeof kofiwidget2 !== "undefined") {
            kofiwidget2.init("Support me on Ko-fi", "#72a4f2", "R5E3224KOP");
            kofiwidget2.draw();
        }
    </script>
```

Notes on the integration:

- Ko-fi username `R5E3224KOP`, label *"Support me on Ko-fi"*, colour `#72a4f2` — sits well against the site accent `#4a90d9` (`src/css/theme.css`).
- The `typeof kofiwidget2 !== "undefined"` guard is the **only** deviation from the snippet you pasted. It prevents a `ReferenceError` in the console if the Ko-fi CDN is blocked or the device is offline. Behaviour is identical when the widget loads.
- Safe with `build.mjs`: `buildHtml()` only rewrites `<script type="module" src="/js/...">`, so these classic scripts pass through untouched.
- Nothing blocks the external script — the server (`server/static.js`) sets no CSP, and nginx (`ops/nginx/*`) only sets `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`.
- Layout: the widget renders as a floating button in the **bottom-left**; the toast is bottom-centre (`src/css/toast.css`), so they do not overlap.

## 2. Verified

| Check | Result |
|---|---|
| `npm test` | **87/87 pass** |
| `git diff --stat` | only real content change is `src/index.html` (+9 lines) |
| Ko-fi tag present in `src/index.html` | yes, 5 matching lines |

## 3. Resolved — deployed and live

The build now succeeds and the Ko-fi button is live on the server.

### 3a. The share blocker no longer applies

The project has moved off the SMB/gvfs share onto a local ext4 filesystem
(`/dev/nvme0n1p2` → `/`). `build.mjs`'s `cpSync()` needs `chmod`/`copyFile`,
both of which the share rejected with `ENOTSUP`; on ext4 they work normally.
`npm run build:prod` completes and `dist/index.html` now carries the Ko-fi tag.

### 3b. Two permission problems the copy left behind

Moving off the share exposed damage the copy had done to this working tree.
Both were fixed, and neither is committed:

| Problem | Symptom | Fix |
|---|---|---|
| `node_modules/**` lost exec bits (all 11 files) | `esbuild ... EACCES`, build refused to start | `npm ci` — reinstalled from the lockfile with correct modes |
| `.deploy-local/id_ed25519` was mode `0664` | `WARNING: UNPROTECTED PRIVATE KEY FILE` → rsync auth failed | `chmod 600` |
| `.deploy-local/host.env` was mode `0664` | inconsistent with the rest of the credentials | `chmod 600` |

Note the second one: the deploy key was **silently rejected** by SSH because of
its permissions, so the deploy failed at the rsync step even though the build
had succeeded. `chmod 600` on the key is required before deploying.

### 3c. IP + port — now live-verified

| Setting | Value |
|---|---|
| Host / IP | `192.168.100.195` |
| App port | `9865` |
| Site URL | **http://192.168.100.195:9865/** |
| SSH port / user | `22` / `root` |
| App dir on target | `/opt/voidflippr` |
| Deploy key | `.deploy-local/id_ed25519` |

Live-verified, not just read from config:

```
$ curl -fsS http://192.168.100.195:9865/healthz
{"ok":true,"uptime":7,"storage":"json"}
```

The served `dist/index.html` on the box contains the Ko-fi tag, and the page
grew from 10,550 to 10,905 bytes.

## 4. Deploy command used

```bash
npm ci                                    # restore node_modules permissions
npm test                                  # 87/87
npm run build:prod                        # succeeds on ext4
chmod 600 .deploy-local/id_ed25519        # required: ssh rejects a loose key
./scripts/deploy-local.sh                 # tests + build + rsync + restart + health check
```

## 5. Git noise — resolved, not worked around

The share forced mode `755` on every file, so `git status` showed 68 modified
files that were file-mode changes only. The repo has `core.fileMode = true`
(since commit `534f5a7`, which made the shell scripts executable), so the exec
bits were restored with `chmod +x` rather than silenced with
`core.fileMode false`.

`git diff` is now limited to the two real changes: `src/index.html` and this
file.

## 6. Verification summary

| Check | Result |
|---|---|
| `npm test` | **87/87 pass** |
| `npm run build:prod` | ✅ completes on ext4 |
| Ko-fi tag in `dist/index.html` | ✅ 3 `kofiwidget2` lines + CDN `<script>` |
| Ko-fi CDN (`storage.ko-fi.com/cdn/widget/Widget_2.js`) | ✅ HTTP 200, defines `kofiwidget2` |
| Widget API signature | ✅ `init(pText, pColor, pId)` — matches the call |
| Deploy | ✅ rsync → systemd restart → active (18 MB RSS) |
| Live HTML contains the tag | ✅ lines 212–216 on the served page |
| Live page size | 10,905 B (was 10,550 B before the change) |
| `ko-fi.com/R5E3224KOP` | HTTP 403 to `curl` — Cloudflare bot protection, which also 403s the site root. **Not a broken username.** Needs a real browser to confirm. |

## 7. Still open

- The Ko-fi username `R5E3224KOP` has not been confirmed in a real browser —
  `curl` is blocked by Cloudflare on every ko-fi.com URL, including the root.
  Worth one manual click: open <http://192.168.100.195:9865/> and confirm the
  button appears bottom-left and links through.
- `PermitRootLogin` is still `yes` on the container (changed during SSH
  setup). `prohibit-password` works now that the key is installed.
- The MooseFS storage should be marked `shared 1` for HA restarts on other
  nodes.
