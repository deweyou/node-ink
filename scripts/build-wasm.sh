#!/usr/bin/env bash

set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$workspace_root/packages/engine-web/generated"
cargo_target_dir="${NODEINK_CARGO_TARGET_DIR:-${TMPDIR:-/tmp}/nodeink-cargo-target}"
wasm_opt="$workspace_root/node_modules/.bin/wasm-opt"

export CARGO_TARGET_DIR="$cargo_target_dir"

if [[ ! -x "$wasm_opt" ]]; then
  echo "Binaryen wasm-opt is missing; run pnpm install first." >&2
  exit 1
fi

wasm-pack build "$workspace_root/crates/nodeink-wasm" \
  --target web \
  --release \
  --no-opt \
  --out-dir "$output_dir" \
  --out-name nodeink_engine

wasm_input="$output_dir/nodeink_engine_bg.wasm"
optimization_dir="$(mktemp -d "$output_dir/.nodeink-wasm-opt.XXXXXX")"
cleanup() {
  rm -rf "$optimization_dir"
}
trap cleanup EXIT

"$wasm_opt" "$wasm_input" -Oz -o "$optimization_dir/nodeink_engine_bg.wasm"
mv "$optimization_dir/nodeink_engine_bg.wasm" "$wasm_input"
