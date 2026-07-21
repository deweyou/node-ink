#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CARGO_TARGET_DIR="${NODEINK_CARGO_TARGET_DIR:-${TMPDIR:-/tmp}/nodeink-cargo-coverage-target}"

expected_version="cargo-llvm-cov 0.8.7"
if ! actual_version="$(cargo llvm-cov --version 2>/dev/null)"; then
  printf 'install %s with: cargo install cargo-llvm-cov --version 0.8.7 --locked\n' \
    "$expected_version" >&2
  exit 1
fi
if [[ "$actual_version" != "$expected_version" ]]; then
  printf 'expected %s, found %s\n' "$expected_version" "$actual_version" >&2
  exit 1
fi

cd "$project_dir"
cargo llvm-cov \
  --package nodeink-core \
  --lib \
  --tests \
  --summary-only \
  --fail-under-functions 90 \
  --fail-under-regions 90 \
  --fail-under-file-lines 90 \
  --fail-under-lines 90
