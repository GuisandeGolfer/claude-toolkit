# claude-toolkit

Reusable scripts, templates and lessons from past sessions. **Check here before writing new helper code.**
Everything is dependency-free (Node 22+, Python 3 stdlib, bash, Swift) unless noted.
Origin: the bo1z-mac project (2026-10-10), which wrapped the vel.gg/bo1z WASM game as an offline macOS app
(`~/Desktop/bo1z-mac`, a git repo, is the full worked example).

## Scripts (`scripts/`)
| Script | Use it when | Example |
|---|---|---|
| `cdp.mjs` | You need to drive or inspect a Chromium/Electron page: eval JS, send **trusted** key/mouse input (counts as a user gesture), screenshot, stream console | `CDP_PORT=9333 node cdp.mjs eval 'crossOriginIsolated'` · `node cdp.mjs key Space " " 32` · `node cdp.mjs click 756 491` · `node cdp.mjs shot /tmp/s.jpg` · `node cdp.mjs console 30 reload --exclude='WEB_GL_'` |
| `dir-compare.sh` | You're comparing two folders, local or remote over SSH/Tailscale: identical, same files in a different layout, or real differences | `dir-compare.sh ~/Desktop/x me@other-machine:/home/me/workspace/x` |
| `site-recon.py` | Before wrapping, mirroring or porting a web app: map its JS/worker/wasm graph, isolation headers, and the browser features it needs | `site-recon.py https://vel.gg/bo1z/ --depth 3 --save /tmp/site` |
| `blob-strings.py` | You need configs or scripts buried in binary archives (raw bytes plus every embedded zlib stream, and zip members) | `blob-strings.py 'bind MOUSE1' zone/**/*.ff` · `blob-strings.py '+frag' --zip main/*.iwd` |
| `mirror-audit.py` | Checking an offline mirror: totals by host/status, misses, URL grep, coverage against a manifest | `mirror-audit.py "~/Library/Application Support/bo1z-mac/mirror" --grep wasm` |
| `wkwebview-probe.swift` | Before building a Tauri/WKWebView wrapper: does the app even run in WebKit? | `swift wkwebview-probe.swift https://site/ 40` |
| `away` | Keeping a Mac awake with the **lid closed** (Remote Control sessions). Uses `pmset disablesleep`, with an optional auto-off. Shell functions `away-on [8h]`, `away-off`, `away-status` are in ~/.zshrc | `away on 8h` · `away status` · `away off` |

## Templates (`templates/`)
**`electron-offline-mirror/`** turns any website into an offline desktop app. Electron loads the real
URLs, and `protocol.handle('https')` answers in-scope requests from a disk mirror filled on the first
online run. Copy the folder, edit `mirror.config.json` (startUrl, scope regexes, telemetry stubs), then run
`npm install && npx electron .`. Use `--offline` for strict offline, `--refresh` to pick up a new site
build, `--perf` for FPS/memory logging, and `--remote-debugging-port=9333` to pair with `cdp.mjs`.
`gamepad-to-keys.js` is an optional controller-to-keyboard/mouse shim.

Why this design: keeping the real origin means COOP/COEP headers, OPFS, workers, pthreads and
origin-relative paths all work unchanged, and you never have to reverse-engineer the download protocol.

## Playbook: offline-wrap a web app/game
1. `site-recon.py <url> --save /tmp/site`: find the engine files, workers, manifest, required features,
   telemetry. Then grep the saved JS for `fetch(`, `Content-Length`, `Range`, `?part=`.
2. Copy the template, set the scope to the site and its CDN host(s), and stub telemetry.
3. Run online once with `--remote-debugging-port=9333 --perf`, and use `cdp.mjs` to press keys or click
   through start screens.
4. Run `--offline`, then check `mirror/misses.log` and `mirror-audit.py`. Use `MIRROR_TRACE=1` to find hung
   requests.
5. Measure **app** FPS, not rAF: set `perfOverlayRegex` if the app has its own FPS readout.
6. Package: `npm run package` (an unsigned arm64 .app/.dmg; first launch needs right-click > Open).

## Gotchas learned the hard way
- **net.fetch returns decoded bodies.** Drop `content-encoding`/`content-length`, then re-derive
  `content-length` from the stored body. Some loaders reject files without it ("Invalid download length").
- **Cache 404s.** Apps probe optional files and accept 404, but an offline 504 crashes them.
- **Page URLs with client-only query params** (`?perf=1`) miss offline. Key extensionless URLs by path only.
- **Transports rename files** (`.br/<k>` chunks, `.kop` opus, `.dxs`, `?part=k`), so coverage checks need
  every suffix.
- **rAF FPS ≠ game FPS.** Read the engine's own counter.
- **A game "stuck" on a loading screen may just be paused.** Check its logs (`paused=1`) and try Esc
  before debugging the network.
- **Synthetic DOM events vs trusted input:** `KeyboardEvent`/`MouseEvent` dispatched from a preload reach
  page listeners that check `event.code`/`movementX` but are **not** user gestures. Use CDP
  `Input.dispatch*` when you need a real gesture (audio start, pointer lock).
- **Electron `setFullScreen` before first load is ignored on macOS.** Call it on `did-finish-load`.
- **Preload `require('./x')` needs `sandbox: false`.**
- **WebKit (Safari 26.6) lacks WebAssembly JSPI.** Emscripten builds using JSPI can't run in
  WKWebView/Tauri. Check with `wkwebview-probe.swift` first.
- **zsh doesn't word-split `$var`.** In loops that pass flags, call the script per case or use arrays, or run
  it under `bash`.
- **Tailscale SSH policy may allow only certain users** ("tailnet policy does not permit you to SSH as
  user X"). Try the machine's real username before falling back to root.

- **Amphetamine 5.3.2 lid protection doesn't survive opening the lid** (macOS 26): it's cleared on open and
  re-armed only on the next session change, so open → close = sleep (`log show` says "sleep reason Clamshell
  Sleep", with `setClamShellSleepDisable 0->2` arriving ms too late). Use `scripts/away`. Diagnose with
  `/usr/bin/log show --predicate 'process == "kernel" AND eventMessage CONTAINS "clamshell"'`. Note that `log`
  alone is a zsh builtin, so use `/usr/bin/log`.

## Links
See [LINKS.md](LINKS.md).
