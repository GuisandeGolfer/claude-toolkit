#!/usr/bin/env python3
"""
mirror-audit.py: inspect a cache-through mirror written by templates/electron-offline-mirror
(files <sha>.body + <sha>.json sidecars holding {url, status, headers}).

    mirror-audit.py ~/Library/Application\\ Support/<app>/mirror                 summary by host/status
    mirror-audit.py <mirror> --grep shaders.pack                                  list matching URLs
    mirror-audit.py <mirror> --manifest manifest.json --path-regex '/packs/kino/(.+?)(\\.dxs|\\.kop)?(\\.br/\\d+)?$'
        coverage: every manifest "files[].path" must appear as group(1) of some cached URL

Lesson from bo1z: transports rename files (.br/<k> chunks, .kop opus, .dxs, ?part=k), so a naive
path match under-reports coverage. Put every suffix the app uses into --path-regex.
"""
import argparse, collections, glob, json, os, re, sys, urllib.parse

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mirror"); ap.add_argument("--grep"); ap.add_argument("--manifest"); ap.add_argument("--path-regex")
    a = ap.parse_args()
    entries = []
    for meta in glob.glob(os.path.join(a.mirror, "*", "*.json")):
        m = json.load(open(meta)); body = meta[:-5] + ".body"
        entries.append((m["url"], m["status"], os.path.getsize(body) if os.path.exists(body) else 0))
    by = collections.defaultdict(lambda: [0, 0])
    for url, status, size in entries:
        k = (urllib.parse.urlparse(url).netloc, status); by[k][0] += 1; by[k][1] += size
    print(f"{len(entries)} entries, {sum(e[2] for e in entries) / 1e6:.0f} MB")
    for (host, status), (n, size) in sorted(by.items()):
        print(f"  {host:<28} {status}  {n:>5} entries  {size / 1e6:8.1f} MB")
    misses = os.path.join(a.mirror, "misses.log")
    if os.path.exists(misses):
        lines = open(misses).read().splitlines()
        print(f"misses.log: {len(lines)} line(s)" + ("".join(f"\n  {l}" for l in lines[-10:]) if lines else ""))
    if a.grep:
        for url, status, size in sorted(entries):
            if a.grep in url: print(f"  {status} {size:>10,} {url}")
    if a.manifest:
        if not a.path_regex: sys.exit("--manifest needs --path-regex")
        rx, have = re.compile(a.path_regex), set()
        for url, status, _ in entries:
            m = rx.search(urllib.parse.urlparse(url).path)
            if m and status in (200, 206): have.add(urllib.parse.unquote(m.group(1)))
        files = json.load(open(a.manifest))["files"]
        missing = [f for f in files if f["path"] not in have]
        print(f"manifest coverage: {len(files) - len(missing)}/{len(files)}")
        for f in missing: print(f"  MISSING {f['path']} {f.get('size', '')} {f.get('priority', '')}")
        return 1 if missing else 0

if __name__ == "__main__":
    sys.exit(main())
