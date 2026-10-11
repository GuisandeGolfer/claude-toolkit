#!/usr/bin/env python3
"""
blob-strings.py: find text (configs, scripts, rawfiles) buried in binary game/app archives.

Searches each file's raw bytes and every embedded zlib stream (many engines compress rawfiles
individually; IW/Treyarch fastfiles, Unity, etc.), and prints a context window around matches.

    blob-strings.py 'default_mp_controls' zone/**/*.ff
    blob-strings.py 'bind MOUSE1' --context 3000 zone/english/*.ff
    blob-strings.py '+actionslot' --zip main/*.iwd      # also look inside .zip/.iwd/.pk3 members

Found BO1's PC default keybinds this way (default_mp_controls.cfg inside en_code_pre_gfx_mp.ff).
"""
import argparse, glob, re, sys, zipfile, zlib

def zlib_streams(data, limit):
    for m in re.finditer(rb"\x78[\x01\x5e\x9c\xda]", data):
        try:
            out = zlib.decompressobj().decompress(data[m.start():m.start() + limit])
            if out: yield m.start(), out
        except zlib.error:
            pass

def report(label, data, needle, context):
    for m in re.finditer(re.escape(needle), data):
        lo, hi = max(0, m.start() - 200), m.start() + context
        print(f"===== {label} @ {m.start()}")
        print(data[lo:hi].decode("latin1").replace("\0", "")); print()
        return True
    return False

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("needle"); ap.add_argument("files", nargs="+")
    ap.add_argument("--context", type=int, default=1500, help="bytes to print after a match")
    ap.add_argument("--zlib-limit", type=int, default=4_000_000, help="max bytes to read per zlib stream")
    ap.add_argument("--zip", action="store_true", help="search members of zip-like archives too")
    a = ap.parse_args()
    needle, hits = a.needle.encode(), 0
    paths = [p for pat in a.files for p in (glob.glob(pat, recursive=True) or [pat])]
    for path in paths:
        data = open(path, "rb").read()
        hits += report(f"{path} (raw)", data, needle, a.context)
        for off, out in zlib_streams(data, a.zlib_limit):
            hits += report(f"{path} (zlib @ {off})", out, needle, a.context)
        if a.zip and zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as z:
                for name in z.namelist():
                    hits += report(f"{path}:{name}", z.read(name), needle, a.context)
    print(f"{hits} match(es) in {len(paths)} file(s)", file=sys.stderr)
    return 0 if hits else 1

if __name__ == "__main__":
    sys.exit(main())
