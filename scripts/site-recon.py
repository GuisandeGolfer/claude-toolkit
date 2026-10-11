#!/usr/bin/env python3
"""
site-recon.py: map how a web app loads itself, before wrapping, mirroring or porting it.

Fetches a page, then follows same-origin script/module/worker/wasm/json references found in the
HTML and JS (import, new Worker, fetch, string literals ending in .js/.mjs/.wasm/.json) to a
depth limit. For each URL it prints the status, size, content-type and isolation headers, then
flags the browser features the code uses (WebGPU, SharedArrayBuffer, OPFS, JSPI, AudioWorklet,
Gamepad, service worker, telemetry endpoints).

    site-recon.py https://vel.gg/bo1z/ [--depth 3] [--save DIR]

--save keeps every fetched file in DIR, so you can grep it later (recommended).
"""
import argparse, os, re, sys, urllib.parse, urllib.request

UA = {"User-Agent": "Mozilla/5.0 site-recon", "Accept-Encoding": "identity"}
REF = re.compile(r"""(?:import\s*(?:[\w{}\s,*]+from\s*)?|import\(|new\s+(?:Shared)?Worker\(|fetch\(|src=|href=)\s*['"`]([^'"`]+)['"`]"""
                 r"""|['"`]([./\w-]+\.(?:m?js|wasm|json|css|html|wgsl|pack))['"`?]""")
FEATURES = {
    "WebGPU": r"navigator\.gpu|requestAdapter", "WebGL2": r"webgl2",
    "SharedArrayBuffer/threads": r"SharedArrayBuffer|crossOriginIsolated",
    "OPFS": r"getDirectory\(|createSyncAccessHandle", "IndexedDB": r"indexedDB",
    "WASM JSPI": r"WebAssembly\.(Suspending|promising)|JSPI", "AudioWorklet": r"audioWorklet|AudioWorklet",
    "WebCodecs": r"AudioDecoder|VideoDecoder", "Gamepad": r"getGamepads", "PointerLock": r"requestPointerLock",
    "ServiceWorker": r"serviceWorker\.register", "Telemetry/beacon": r"sendBeacon|telemetry|analytics",
}

def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), b""

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url"); ap.add_argument("--depth", type=int, default=3); ap.add_argument("--save")
    a = ap.parse_args()
    origin = urllib.parse.urlparse(a.url).netloc
    seen, queue, found = set(), [(a.url, 0)], {}
    while queue:
        url, depth = queue.pop(0)
        if url in seen: continue
        seen.add(url)
        status, headers, body = fetch(url)
        h = {k.lower(): v for k, v in headers.items()}
        iso = " ".join(f"{label}={h[k]}" for label, k in (("COOP", "cross-origin-opener-policy"), ("COEP", "cross-origin-embedder-policy")) if k in h)
        print(f"{'  ' * depth}{status} {len(body):>9,} {h.get('content-type', '?')[:24]:<24} {url} {iso}")
        if a.save and body:
            path = os.path.join(a.save, urllib.parse.urlparse(url).path.lstrip("/") or "index.html")
            if path.endswith("/"): path += "index.html"
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            open(path, "wb").write(body)
        text = body.decode("utf-8", "ignore") if b"\0" not in body[:2000] else ""
        for name, pat in FEATURES.items():
            if text and re.search(pat, text): found.setdefault(name, set()).add(urllib.parse.urlparse(url).path)
        if depth >= a.depth or not text: continue
        for m in REF.finditer(text):
            ref = m.group(1) or m.group(2)
            if not ref or ref.startswith(("data:", "blob:", "#", "mailto:")): continue
            nxt = urllib.parse.urljoin(url, ref)
            if urllib.parse.urlparse(nxt).netloc == origin and nxt not in seen:
                queue.append((nxt, depth + 1))
    print("\nFeatures referenced:")
    for name, files in sorted(found.items()):
        print(f"  {name:<26} {', '.join(sorted(files))[:150]}")

if __name__ == "__main__":
    sys.exit(main())
