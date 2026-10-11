#!/usr/bin/env bash
# Compare two directory trees by SHA-256: same paths? same contents? moved files?
# Either side may be remote ([user@]host:/path, via ssh; Tailscale hostnames work).
#
#   dir-compare.sh ~/Desktop/foo diegog@omarchy-desktop:/home/diegog/workspace/foo
#   dir-compare.sh ./a ./b
#
# Output: identical / content-identical-but-different-layout / per-file differences.
# Ignores .DS_Store. Read-only on both sides.
set -euo pipefail
[ $# -eq 2 ] || { sed -n '2,9p' "$0"; exit 2; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# Prints "<relative path>\t<sha256>" for every file under a local or remote dir.
# The hashing script is sent over stdin (sh -s) so no nested quoting is needed for ssh.
HASH_SCRIPT='cd "$1" || exit 1
if command -v sha256sum >/dev/null 2>&1; then H="sha256sum"; else H="shasum -a 256"; fi
find . -type f ! -name .DS_Store -exec $H {} +'
hash_tree() {
  local spec=$1
  if [[ $spec == *:* && ! -e $spec ]]; then
    printf '%s\n' "$HASH_SCRIPT" | ssh -o BatchMode=yes -o ConnectTimeout=10 "${spec%%:*}" sh -s -- "${spec#*:}"
  else
    printf '%s\n' "$HASH_SCRIPT" | sh -s -- "$spec"
  fi | awk '{h=$1; $1=""; sub(/^ +/,""); print $0"\t"h}' | sort
}

hash_tree "$1" > "$tmp/a"
hash_tree "$2" > "$tmp/b"
echo "A: $(wc -l < "$tmp/a" | tr -d ' ') files  ($1)"
echo "B: $(wc -l < "$tmp/b" | tr -d ' ') files  ($2)"

if diff -q "$tmp/a" "$tmp/b" >/dev/null; then echo "IDENTICAL (paths and contents)"; exit 0; fi

cut -f2 "$tmp/a" | sort > "$tmp/ah"; cut -f2 "$tmp/b" | sort > "$tmp/bh"
if diff -q "$tmp/ah" "$tmp/bh" >/dev/null; then
  echo "SAME CONTENTS, DIFFERENT LAYOUT (every file exists on both sides, at different paths)"
  echo "B layout (path in B  <-  path in A):"
  join -t$'\t' -1 2 -2 2 <(sort -t$'\t' -k2 "$tmp/a") <(sort -t$'\t' -k2 "$tmp/b") \
    | awk -F'\t' '$2!=$3 {print "  " $3 "  <-  " $2}' | sort
  exit 0
fi

echo "DIFFERENT"
echo "-- content only in A:"; comm -23 "$tmp/ah" "$tmp/bh" | while read -r h; do grep -F "$h" "$tmp/a" | cut -f1 | sed 's/^/  /'; done
echo "-- content only in B:"; comm -13 "$tmp/ah" "$tmp/bh" | while read -r h; do grep -F "$h" "$tmp/b" | cut -f1 | sed 's/^/  /'; done
exit 1
