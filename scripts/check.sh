#!/usr/bin/env bash
# Pre-flight checks for Dux-Soup High Fly.
#
# Run this before every commit and deploy:   bash scripts/check.sh
# deploy.sh runs it automatically and refuses to ship if anything fails.
#
# Needs only bash + node (both preinstalled in Google Cloud Shell).

set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=1; }

echo "High Fly pre-flight checks"

# 1. Required files are present -------------------------------------------
for f in index.html firebase.json .firebaserc og-image.jpg apple-touch-icon.png \
         favicon-32.png icon-192.png icon-512.png manifest.webmanifest CHANGELOG.md \
         assets/dux.png assets/dux-magenta.png assets/title.png assets/sun.png \
         assets/moon.png assets/cloud-day.png assets/cloud-night-1.png assets/cloud-night-2.png \
         assets/skins/solid-day.png assets/skins/solid-magenta.png assets/skins/bold-day.png \
         assets/skins/bold-magenta.png assets/skins/soft-day.png assets/skins/soft-magenta.png \
         assets/skins/pixel-day.png assets/skins/pixel-magenta.png; do
  [ -f "$f" ] || bad "missing file: $f"
done
[ $fail -eq 0 ] && ok "all required files present"

# 2. Version in the game matches the newest CHANGELOG entry ----------------
game_ver=$(grep -oE "DEPLOY_VERSION = '[^']+'" index.html | head -1 | sed -E "s/.*'([^']+)'/\1/")
log_ver=$(grep -oE '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md | head -1 | tr -d '#[] ')
if [ -z "$game_ver" ]; then
  bad "could not find DEPLOY_VERSION in index.html"
elif ! [[ "$game_ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  bad "DEPLOY_VERSION '$game_ver' is not in x.y.z form"
elif [ "$game_ver" != "$log_ver" ]; then
  bad "version mismatch: index.html says $game_ver but CHANGELOG.md's newest entry is $log_ver"
  echo "       Fix: add a '## [$game_ver]' section to the top of CHANGELOG.md (or bump DEPLOY_VERSION)."
else
  ok "version $game_ver matches CHANGELOG.md"
fi

# 3. Both inline scripts are valid JavaScript ------------------------------
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
    const html = fs.readFileSync("index.html", "utf8");
    const re = /<script( type="module")?>([\s\S]*?)<\/script>/g;
    let m, i = 0, bad = 0;
    while ((m = re.exec(html))) {
      const f = path.join(os.tmpdir(), `hf-check-${process.pid}-${i++}` + (m[1] ? ".mjs" : ".js"));
      fs.writeFileSync(f, m[2]);
      try { cp.execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
      catch (e) { bad = 1; process.stderr.write(String(e.stderr)); }
      fs.unlinkSync(f);
    }
    if (i < 2) { console.error("expected 2 inline scripts, found " + i); process.exit(1); }
    process.exit(bad);
  ' && ok "game scripts parse cleanly" || bad "JavaScript syntax error in index.html (see above)"
else
  bad "node is not installed, cannot syntax-check the game"
fi

# 4. Known regressions ------------------------------------------------------
# Unquoted "Press Start 2P" is invalid in a canvas font string and silently
# falls back to 12px sans-serif. Always use the PIXEL_FONT constant.
if grep -q "textFont('Press Start 2P')" index.html; then
  bad "found textFont('Press Start 2P'); use textFont(PIXEL_FONT) instead"
else
  ok "pixel font calls use PIXEL_FONT"
fi

# 5. Link-preview tags point at absolute URLs ------------------------------
if grep -q 'property="og:image" content="https://' index.html && grep -q 'name="twitter:image" content="https://' index.html; then
  ok "share preview tags use absolute image URLs"
else
  bad "og:image / twitter:image must be absolute https:// URLs or previews break"
fi

echo
if [ $fail -ne 0 ]; then
  echo "Checks FAILED. Fix the items above before committing or deploying."
  exit 1
fi
echo "All checks passed."
