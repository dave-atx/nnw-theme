#!/usr/bin/env bash
# Runs a packed nnw-theme tarball's check against the template's starter and against
# ember, so what is tested is exactly what npm would publish.
#
#   scripts/packed/check.sh nnw-theme-X.Y.Z.tgz TEMPLATE_DIR EMBER_DIR
#
# Ember's expected failures live in scripts/packed/ember-baseline-<os>.txt; the check
# fails when ember's report differs from it. Without a baseline for this OS, ember's
# result is reported but does not fail the run.
set -euo pipefail

tarball=$(realpath "$1")
template=$(realpath "$2")
ember=$(realpath "$3")
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

npm install --silent --no-save --prefix "$work/tool" "$tarball"
nnw="$work/tool/node_modules/.bin/nnw-theme"
echo "Testing $("$nnw" --version) from $(basename "$tarball")"

# The starter: initialized with the template CI's fixed answers, then the full gate.
cp -R "$template" "$work/starter"
cd "$work/starter"
if [ -e .nnw-theme-uninitialized ]; then
  "$nnw" init --name "Neutral Reader" --creator "Template Maintainer" \
    --homepage "https://github.com/dave-atx/netnewswire-theme-template" \
    --identifier "io.github.dave-atx.neutral-reader" \
    --confirm-identifier "io.github.dave-atx.neutral-reader" \
    --marketplace no --no-install-browser
fi
"$nnw" check --no-open

# Ember: fixtures still live in test/ until it adopts the tooling.
cp -R "$ember" "$work/ember"
cd "$work/ember"
if [ -d test ] && [ ! -d fixtures ]; then
  mkdir fixtures
  mv test/*.toml fixtures/
fi
status=0
"$nnw" check --no-open || status=$?
report=$(grep -v '^nnw-theme ' build/check-report.txt)
baseline="$here/ember-baseline-$(uname -s | tr '[:upper:]' '[:lower:]').txt"
if [ -f "$baseline" ]; then
  if ! diff -u "$baseline" <(printf '%s\n' "$report"); then
    echo "Ember's check report differs from $(basename "$baseline")." >&2
    exit 1
  fi
  echo "Ember matches its baseline (check exit $status)."
else
  echo "No ember baseline for this OS; ember's check exited $status:"
  printf '%s\n' "$report"
fi
