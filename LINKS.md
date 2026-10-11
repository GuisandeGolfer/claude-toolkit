# Links

## Projects and examples on this machine
- `~/Desktop/bo1z-mac` (author's machine, not shared): the full worked example (Electron offline mirror, gamepad shim, perf, packaging,
  docs/PERF.md, docs/METAL-SPIKE.md). A git repo.
- `~/Desktop/bo1z-assets` (author's machine, not shared): BO1 Zombies retail-layout assets plus `download_assets.py`, a manifest-driven,
  SHA-256-verified downloader for chunked brotli packs (`Accept-Encoding: identity` trick).

## BO1 Zombies / vel.gg
- https://vel.gg/bo1z/: the browser port (Emscripten + WebGPU, pthreads, JSPI, OPFS)
- https://github.com/MisaDev4/bo1-zombies-decompiled: the decompiled engine (Win32/D3D only; web backend not public)
- https://github.com/SwagSoftware/KisakBlack: BO1 MP reimplementation (GPL-3.0, Win32)
- https://github.com/invictus841/bo1z-coop-extension: 2-player co-op Chrome extension plus a Cloudflare relay

## Electron / Chromium
- https://www.electronjs.org/docs/latest/api/protocol#protocolhandlescheme-handler: `protocol.handle` (intercepting https)
- https://www.electronjs.org/docs/latest/api/net#netfetchinput-init: `net.fetch` with `bypassCustomProtocolHandlers`
- https://www.electronjs.org/docs/latest/api/app#appgetappmetrics: per-process memory for perf logs
- https://chromedevtools.github.io/devtools-protocol/: CDP reference (Input, Runtime, Page domains)
- https://www.electron.build/: electron-builder packaging

## Web platform features to check when porting
- https://web.dev/articles/coop-coep: cross-origin isolation (needed for SharedArrayBuffer/pthreads)
- https://github.com/WebAssembly/js-promise-integration: JSPI (not in WebKit as of Safari 26.6)
- https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system: OPFS
