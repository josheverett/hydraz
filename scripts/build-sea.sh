#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

BINARY_NAME="hydraz"

VERSION=$(node -p "require('./package.json').version")

echo "==> Bundling with esbuild..."
npx esbuild src/cli/index.ts --bundle --platform=node --format=cjs \
  --define:__SEA_VERSION__="\"${VERSION}\"" \
  --outfile=dist/hydraz-sea.cjs

echo "==> Generating SEA blob..."
node --experimental-sea-config sea-config.json

echo "==> Copying Node binary..."
cp "$(which node)" "$BINARY_NAME"

if [[ "$(uname)" == "Darwin" ]]; then
  echo "==> Removing macOS code signature..."
  codesign --remove-signature "$BINARY_NAME"
fi

echo "==> Injecting SEA blob..."
POSTJECT_ARGS=("$BINARY_NAME" NODE_SEA_BLOB dist/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2)

if [[ "$(uname)" == "Darwin" ]]; then
  POSTJECT_ARGS+=(--macho-segment-name NODE_SEA)
fi

npx postject "${POSTJECT_ARGS[@]}"

if [[ "$(uname)" == "Darwin" ]]; then
  echo "==> Re-signing for macOS..."
  codesign --sign - "$BINARY_NAME"
fi

echo "==> Smoke test:"
"./$BINARY_NAME" --version

VERSION=$(node -p "require('./package.json').version")
ARCH=$(uname -m)
[[ "$ARCH" == "x86_64" ]] && ARCH="x64"
[[ "$ARCH" == "arm64" ]] && ARCH="arm64"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
TARBALL="${BINARY_NAME}-${VERSION}-${OS}-${ARCH}.tar.gz"

echo "==> Packaging tarball..."
tar -czf "$TARBALL" "$BINARY_NAME"

echo "==> SHA256:"
shasum -a 256 "$TARBALL"

echo "==> Done. Artifact: $TARBALL"
