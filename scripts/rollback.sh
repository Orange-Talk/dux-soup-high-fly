#!/usr/bin/env bash
# Put an earlier version of High Fly back live, fast.
#
#   bash scripts/rollback.sh 1.14.0
#
# It finds the newest commit on GitHub main whose index.html has that
# DEPLOY_VERSION, deploys exactly those files, and checks the live site.
# GitHub main is NOT changed, so the newer code stays saved for later.
# (The deploy script will notice live != main next time and that is fine:
# a normal deploy of a newer version simply moves live forward again.)
#
# Alternative with no terminal: Firebase console > Hosting > Release history
# > find the release labelled with that version > Rollback.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="highflygame-1ac8f"
LIVE_URL="https://highflygame-1ac8f.web.app/"
FIREBASE_TOOLS="firebase-tools@15"

want="${1:-}"
[[ "$want" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Usage: bash scripts/rollback.sh 1.14.0"; exit 1; }

git fetch --quiet origin main
sha=""
for c in $(git rev-list origin/main); do
  # git grep (not "git show | grep -q"): with pipefail, grep -q closing the
  # pipe early makes the pipeline fail and every version looks missing.
  if git grep -q -F "DEPLOY_VERSION = '$want'" "$c" -- index.html 2>/dev/null; then sha="$c"; break; fi
done
[ -n "$sha" ] || { echo "No commit on main has version $want. Versions are listed in CHANGELOG.md."; exit 1; }
short=$(git rev-parse --short "$sha")
echo "Rolling back to v$want (commit $short)"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git archive "$sha" | tar -x -C "$tmp"
# always use today's deploy config, so old ignore-list bugs can't come back
git show origin/main:firebase.json > "$tmp/firebase.json"
git show origin/main:.firebaserc > "$tmp/.firebaserc"

( cd "$tmp" && npx --yes "$FIREBASE_TOOLS" deploy --only hosting --project "$PROJECT" \
    --message "ROLLBACK to v$want ($short)" --non-interactive )

sleep 3
now=$(curl -fsSL --max-time 15 "$LIVE_URL?v=rb$short" | grep -oE "DEPLOY_VERSION = '[^']+'" | head -1 | sed -E "s/.*'([^']+)'/\1/" || true)
[ "$now" = "$want" ] || { echo "Deployed, but the site reports '${now:-nothing}'. Check Firebase console > Hosting."; exit 1; }
printf '\n\033[32mDONE.\033[0m v%s is live again. GitHub main still has the newer version saved.\n' "$want"
