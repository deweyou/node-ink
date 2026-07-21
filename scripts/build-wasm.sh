#!/usr/bin/env bash

set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$workspace_root/packages/engine-web/generated"
cargo_target_dir="${NODEINK_CARGO_TARGET_DIR:-${TMPDIR:-/tmp}/nodeink-cargo-target}"

export CARGO_TARGET_DIR="$cargo_target_dir"

wasm-pack build "$workspace_root/crates/nodeink-wasm" \
  --target web \
  --release \
  --out-dir "$output_dir" \
  --out-name nodeink_engine
