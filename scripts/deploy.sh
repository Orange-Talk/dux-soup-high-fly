#!/usr/bin/env bash
# One-command deploy for Dux-Soup High Fly.
#
#   bash scripts/deploy.sh            normal deploy
#   bash scripts/deploy.sh --force    redeploy even if this version is already live
#
# Rule this script enforces: what is live is exactly what is on GitHub main.
# It refuses to deploy uncommitted edits, a branch other than main, a copy that
# is behind or ahead of GitHub, a build that fails scripts/check.sh, or a
# version number that is already live (bump DEPLOY_VERSION instead).
#
# Easiest place to run it: Google Cloud Shell (https://shell.cloud.google.com)
# signed in as the Firebase project owner. See README.md, "Deploying".

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="highflygame-1ac8f"
LIVE_URL="https://highflygame-1ac8f.web.app/"
FIREBASE_TOOLS="firebase-tools@15"   # pinned major version so behaviour doesn't drift

force=0
[ "${1:-}" = "--force" ] && force=1

die() { printf '\n\033[31mSTOPPED:\033[0m %s\n' "$1"; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step "Checking git state"
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || die "you are on '$branch'. Deploy from main: git checkout main && git pull"
[ -z "$(git status --porcelain)" ] || { git status --short; die "uncommitted changes. Commit and push them to GitHub first, so live always matches GitHub."; }
git fetch --quiet origin main
local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse origin/main)
if [ "$local_sha" != "$remote_sha" ]; then
  if git merge-base --is-ancestor HEAD origin/main; then
    die "this copy is behind GitHub. Run: git pull"
  else
    die "this copy has commits that are not on GitHub. Push them first."
  fi
fi
short_sha=$(git rev-parse --short HEAD)
echo "main @ $short_sha, in sync with GitHub"

step "Running pre-flight checks"
bash scripts/check.sh || die "pre-flight checks failed"

version=$(grep -oE "DEPLOY_VERSION = '[^']+'" index.html | head -1 | sed -E "s/.*'([^']+)'/\1/")

step "Comparing with what is live"
live_version=$(curl -fsSL --max-time 15 "$LIVE_URL" 2>/dev/null | grep -oE "DEPLOY_VERSION = '[^']+'" | head -1 | sed -E "s/.*'([^']+)'/\1/" || true)
echo "live: ${live_version:-unknown}   this build: $version"
if [ "$live_version" = "$version" ] && [ $force -eq 0 ]; then
  die "v$version is already live. Bump DEPLOY_VERSION in index.html and add a CHANGELOG.md entry, or rerun with --force to redeploy the same version."
fi

step "Deploying v$version ($short_sha) to Firebase Hosting"
npx --yes "$FIREBASE_TOOLS" deploy --only hosting --project "$PROJECT" \
  --message "v$version ($short_sha)" --non-interactive

step "Verifying the live site"
sleep 3
now_live=$(curl -fsSL --max-time 15 -H 'Cache-Control: no-cache' "$LIVE_URL?v=$short_sha" | grep -oE "DEPLOY_VERSION = '[^']+'" | head -1 | sed -E "s/.*'([^']+)'/\1/" || true)
[ "$now_live" = "$version" ] || die "deploy finished but the site reports '${now_live:-nothing}' instead of $version. Check the Firebase console > Hosting."
og_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${LIVE_URL}og-image.jpg")
[ "$og_status" = "200" ] || die "share preview image returned HTTP $og_status"

printf '\n\033[32mDONE.\033[0m v%s (%s) is live at %s\n' "$version" "$short_sha" "$LIVE_URL"
echo "Firebase keeps every release: Firebase console > Hosting > Release history (one-click rollback)."
