#!/usr/bin/env bash
# selftest.sh: verify this toolkit still works before an agent relies on it.
# Offline, read-only, no GUI: syntax checks, exec bits, template config, and (if one is running)
# the CDP bridge. Exit 0 = usable; 1 = at least one FAIL line.
#
#   scripts/selftest.sh
#   CDP_PORT=9333 scripts/selftest.sh     # also exercise cdp.mjs against a running browser
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
pass() { printf '  ok    %s\n' "$*"; }
skip() { printf '  skip  %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; fail=1; }

echo "toolkit: $PWD"

echo "runtimes"
if command -v node >/dev/null; then
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
  [ "${major:-0}" -ge 22 ] && pass "node $(node -v) (need >=22)" || bad "node $(node -v) is older than 22"
else
  bad "node is required"
fi
command -v python3 >/dev/null && pass "python3 $(python3 -V 2>&1 | awk '{print $2}')" || bad "python3 is required"
command -v bash >/dev/null && pass "bash" || bad "bash is required"

echo "syntax"
if command -v python3 >/dev/null; then
  for f in scripts/*.py; do
    python3 -c 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())' "$f" 2>/dev/null \
      && pass "$f parses" || bad "$f parse error"
  done
fi
if command -v node >/dev/null; then
  for f in scripts/*.mjs templates/electron-offline-mirror/*.js; do
    node --check "$f" >/dev/null 2>&1 && pass "$f parses" || bad "$f parse error"
  done
fi
for f in scripts/*.sh scripts/away; do
  bash -n "$f" 2>/dev/null && pass "$f parses" || bad "$f parse error"
done
if command -v swiftc >/dev/null; then
  swiftc -parse scripts/wkwebview-probe.swift >/dev/null 2>&1 \
    && pass "wkwebview-probe.swift parses" || bad "wkwebview-probe.swift parse error"
else
  skip "wkwebview-probe.swift (no swiftc; install Xcode command line tools)"
fi

echo "exec bits and instruction file"
for f in scripts/*; do
  [ -f "$f" ] || continue
  [ -x "$f" ] && pass "$f" || bad "$f is not executable"
done
if [ -L CLAUDE.md ] && [ -f CLAUDE.md ]; then
  pass "CLAUDE.md -> $(readlink CLAUDE.md)"
else
  bad "CLAUDE.md must be a symlink to AGENTS.md so Claude Code sees the same instructions"
fi

echo "template config"
cfg=templates/electron-offline-mirror/mirror.config.json
if command -v node >/dev/null && [ -f "$cfg" ]; then
  if node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const k of ["startUrl", "scope", "pageKeys"]) if (!(k in c)) throw new Error("missing " + k);
    for (const r of [...c.scope, ...c.pageKeys]) new RegExp(r);
    for (const s of c.stub ?? []) new RegExp(s.match);
  ' "$cfg" >/dev/null 2>&1; then
    pass "mirror.config.json (required keys, regexes compile)"
  else
    bad "mirror.config.json is invalid"
  fi
fi

echo "cdp bridge"
port=${CDP_PORT:-9333}
if command -v node >/dev/null && node -e 'fetch(`http://127.0.0.1:${process.argv[1]}/json`).then(() => 0, () => process.exit(1))' "$port" 2>/dev/null; then
  node scripts/cdp.mjs targets >/dev/null 2>&1 \
    && pass "cdp.mjs targets (DevTools on $port)" || bad "cdp.mjs targets failed (DevTools on $port)"
else
  skip "cdp.mjs (no DevTools endpoint on $port; start a browser with --remote-debugging-port=$port)"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS"
  exit 0
fi
echo "FAIL: fix the lines above"
exit 1
