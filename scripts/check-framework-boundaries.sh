#!/usr/bin/env bash
set -euo pipefail

framework_neutral_paths=(
  packages/protocol
  packages/engine-web
  packages/editor-web
  packages/renderer-svg
  packages/persistence-web
)

framework_import_pattern="(?:from[[:space:]]+|import[[:space:]]*\\(|require[[:space:]]*\\()[[:space:]]*['\"](?:react|react-dom|vue)(?:/[^'\"]*)?['\"]"

if rg --line-number --pcre2 "$framework_import_pattern" "${framework_neutral_paths[@]}"; then
  echo "Framework-neutral packages must not import React or Vue." >&2
  exit 1
fi

echo "Framework boundary check passed."
