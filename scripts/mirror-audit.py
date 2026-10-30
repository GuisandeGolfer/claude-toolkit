#!/usr/bin/env python3
"""
mirror-audit.py: inspect a cache-through mirror written by templates/electron-offline-mirror
(files <sha>.body + <sha>.json sidecars holding {url, status, headers}).

    mirror-audit.py ~/Library/Application\\ Support/<app>/mirror                 summary by host/status
    mirror-audit.py <mirror> --grep shaders.pack                                  list matching URLs
    mirror-audit.py <mirror> --manifest manifest.json --path-regex '/packs/kino/(.+?)(\\.dxs|\\.kop)?(\\.br/\\d+)?$'
        coverage: every manifest "files[].path" must appear as group(1) of some cached URL

Add --json for {entries, bytes, byHostStatus, misses, grep, coverage}; exit 1 if coverage is incomplete.

Lesson from bo1z: transports rename files (.br/<k> chunks, .kop opus, .dxs, ?part=k), so a naive
path match under-reports coverage. Put every suffix the app uses into --path-regex.
"""
import argparse, collections, glob, json, os, re, sys, urllib.parse

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mirror"); ap.add_argument("--grep"); ap.add_argument("--manifest"); ap.add_argument("--path-regex")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    a = ap.parse_args()
    entries = []
    for meta in glob.glob(os.path.join(a.mirror, "*", "*.json")):
        m = json.load(open(meta)); body = meta[:-5] + ".body"
        entries.append((m["url"], m["status"], os.path.getsize(body) if os.path.exists(body) else 0))
    by = collections.defaultdict(lambda: [0, 0])
    for url, status, size in entries:
        k = (urllib.parse.urlparse(url).netloc, status); by[k][0] += 1; by[k][1] += size
    report = {
        "mirror": a.mirror,
        "entries": len(entries),
        "bytes": sum(e[2] for e in entries),
        "byHostStatus": [{"host": h, "status": s, "entries": n, "bytes": b}
                         for (h, s), (n, b) in sorted(by.items())],
    }
    misses = os.path.join(a.mirror, "misses.log")
    if os.path.exists(misses):
        lines = open(misses).read().splitlines()
        report["misses"] = {"count": len(lines), "recent": lines[-10:]}
    if a.grep:
        report["grep"] = [{"status": s, "bytes": b, "url": u}
                          for u, s, b in sorted(entries) if a.grep in u]
    missing = None
    if a.manifest:
        if not a.path_regex: sys.exit("--manifest needs --path-regex")
        rx, have = re.compile(a.path_regex), set()
        for url, status, _ in entries:
            m = rx.search(urllib.parse.urlparse(url).path)
            if m and status in (200, 206): have.add(urllib.parse.unquote(m.group(1)))
        files = json.load(open(a.manifest))["files"]
        missing = [f for f in files if f["path"] not in have]
        report["coverage"] = {
            "total": len(files), "present": len(files) - len(missing),
            "missing": [{"path": f["path"], "size": f.get("size"), "priority": f.get("priority")}
                        for f in missing],
        }
    if a.json:
        json.dump(report, sys.stdout, indent=2); print()
        return 1 if missing else 0
    print(f"{report['entries']} entries, {report['bytes'] / 1e6:.0f} MB")
    for r in report["byHostStatus"]:
        print(f"  {r['host']:<28} {r['status']}  {r['entries']:>5} entries  {r['bytes'] / 1e6:8.1f} MB")
    if "misses" in report:
        recent = report["misses"]["recent"]
        print(f"misses.log: {report['misses']['count']} line(s)"
              + ("".join(f"\n  {l}" for l in recent) if recent else ""))
    for r in report.get("grep", []):
        print(f"  {r['status']} {r['bytes']:>10,} {r['url']}")
    if missing is not None:
        print(f"manifest coverage: {report['coverage']['present']}/{report['coverage']['total']}")
        for f in missing: print(f"  MISSING {f['path']} {f.get('size', '')} {f.get('priority', '')}")
    return 1 if missing else 0

if __name__ == "__main__":
    sys.exit(main())
