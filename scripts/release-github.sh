#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

TARBALL=$(ls hydraz-${VERSION}-*.tar.gz 2>/dev/null | head -1)
if [[ -z "$TARBALL" ]]; then
  echo "Error: No tarball found. Run 'npm run build:sea' first."
  exit 1
fi

echo "==> Release details:"
echo "    Tag:     $TAG"
echo "    Asset:   $TARBALL"
echo "    SHA256:  $(shasum -a 256 "$TARBALL" | awk '{print $1}')"
echo ""
read -p "Create tag and GitHub release? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "==> Tag ${TAG} already exists, skipping."
else
  echo "==> Tagging ${TAG}..."
  git tag "$TAG"
  git push origin "$TAG"
fi

echo "==> Creating GitHub release..."
gh release create "$TAG" "$TARBALL" --title "$TAG" --notes "Release ${VERSION}"

echo "==> Done. https://github.com/josheverett/hydraz/releases/tag/${TAG}"
