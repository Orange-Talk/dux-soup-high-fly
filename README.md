# Dux-Soup High Fly

A Flappy-Bird style browser game starring the Dux-Soup duck. Three modes (Day,
Midnight, STACKED), a shared online leaderboard, and medals. Built to be played
on a phone browser.

- **Play it:** https://highflygame-1ac8f.web.app
- **Current version:** shown bottom-right on the home screen, and at the top of
  [CHANGELOG.md](CHANGELOG.md)
- **Owner:** Scott Wright (scott@orange-talk.com)

---

## The 30-second version

| Want to... | Do this |
|---|---|
| Change the game | Edit `index.html`, bump the version, add a CHANGELOG entry, commit |
| Check your change | `bash scripts/check.sh` |
| Put it live | In Cloud Shell: `bash scripts/deploy.sh` (details below) |
| Undo a bad release | Firebase console > Hosting > Release history > Rollback |

Golden rule: **live always equals GitHub `main`.** The deploy script enforces it.

---

## What's in this repo

| Path | What it is | Deployed? |
|---|---|---|
| `index.html` | The entire game: markup, styles, Firebase leaderboard code and all game code (p5.js) | Yes |
| `assets/` | Game art: duck, magenta duck, title logo, sun, moon, 3 clouds; `assets/skins/` holds the 4 extra ducks (Day + magenta each) | Yes |
| `og-image.jpg` | 1200x630 link-preview card shown when the URL is shared | Yes |
| `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Browser tab and home-screen icons | Yes |
| `manifest.webmanifest` | Lets "Add to Home Screen" open the game full-screen | Yes |
| `firebase.json`, `.firebaserc` | Firebase Hosting config (project `highflygame-1ac8f`) | No |
| `scripts/check.sh` | Pre-flight checks (version match, JS syntax, known regressions) | No |
| `scripts/deploy.sh` | One-command safe deploy | No |
| `CHANGELOG.md` | Every release and what changed | No |
| `HANDOFF.md` | Ownership, leaderboard data, security, how to move it to a Dux-Soup account | No |
| `CLAUDE.md` | Instructions for AI assistants working on this repo | No |
| `docs/` | Plans and source art for future features (see `docs/BOSS-PLAN.md`) | No |
| `Duxsoupgame prev builds/` | Old builds and art, kept for reference only | No |

There is no build step, no npm install, and no server code. It is static files.

### Outside services the game depends on

| Service | Used for | Where configured |
|---|---|---|
| Firebase Hosting | Serves the site at `highflygame-1ac8f.web.app` | `firebase.json` |
| Cloud Firestore | Leaderboards (3 documents, one per mode) | `firebaseConfig` in `index.html` |
| Firebase Anonymous Auth | Lets the browser write scores without accounts | Firebase console |
| cdnjs | p5.js 1.4.2 (graphics library) | `<script>` tag in `index.html` |
| Google Fonts | "Press Start 2P" pixel font and "Inter" | `<link>` tag in `index.html` |

All Firebase pieces live in Scott's personal Firebase project. See `HANDOFF.md`
before shipping this as an official Dux-Soup feature.

---

## How to make a change

1. **Edit** `index.html` (and/or files in `assets/`).
2. **Bump the version.** Find `const DEPLOY_VERSION = '...'` near the top of the
   game script and raise it:
   - fix or tweak: `1.14.0` to `1.14.1`
   - new feature: `1.14.1` to `1.15.0`
3. **Log it.** Add a section at the top of `CHANGELOG.md` with the same number
   and today's date, listing what changed in plain English.
4. **Check it.** `bash scripts/check.sh` must say "All checks passed."
5. **Test on a phone-sized screen.** Chrome DevTools > device toolbar (iPhone),
   or open it on a real phone. Run through the test checklist below.
6. **Commit and push to `main`** on GitHub.
7. **Deploy** (next section).

### Test checklist (two minutes, on a phone-sized screen)

- [ ] Home screen: logo, duck, best scores, FLY NOW, Leaderboard and the version number visible
- [ ] FLY NOW opens Choose Your Flight: level buttons switch the background, arrows switch the duck
- [ ] GO shows "TAP TO FLAP" and waits for a tap
- [ ] Score counts up passing pipes; pause button pauses; tap resumes
- [ ] Crash shows Game Over with Fly Again / Share Score / Change Flight / Leaderboard
- [ ] Midnight and STACKED both start and play
- [ ] Leaderboard shows all three tabs with names and scores
- [ ] Sound button toggles sound
- [ ] Rotate the phone mid-run: game pauses instead of breaking

---

## Deploying

Deploys go through **Google Cloud Shell**, a free terminal that runs in the
browser and is already signed in to your Google account. Nothing to install.

1. Open https://shell.cloud.google.com signed in as the Firebase project owner
   (currently scott@orange-talk.com). If Google asks to "Authorize Cloud Shell",
   click Authorize.
2. First time only, get the code:
   ```bash
   git clone https://github.com/Orange-Talk/dux-soup-high-fly.git
   ```
3. Every deploy:
   ```bash
   cd ~/dux-soup-high-fly && git pull && bash scripts/deploy.sh
   ```

The script refuses to deploy if: you have uncommitted edits, you're not on
`main`, your copy differs from GitHub, checks fail, or this version number is
already live. After deploying it confirms the live site reports the new version.

If Firebase asks you to log in, run `npx firebase-tools@15 login --no-localhost`
in Cloud Shell, open the link it prints, approve, and paste the code back.

**Rollback:** in Cloud Shell, `bash scripts/rollback.sh 1.14.0` (any version
in CHANGELOG.md) puts that version back live in about a minute and confirms
it. GitHub keeps the newer code, so you can redeploy it later. No-terminal
option: Firebase console > Hosting > Release history > pick an older release
> Rollback. Each release is labelled with its version and git commit.

### After a deploy: refresh link previews

Apps cache link previews for days. If you changed `og-image.jpg` or the share
text, force a refresh:

- LinkedIn: https://www.linkedin.com/post-inspector/ (paste the URL, Inspect)
- Facebook / WhatsApp: https://developers.facebook.com/tools/debug/ (Scrape Again)
- iMessage / Slack / X: no tool; they refresh on their own within about a week

---

## How the game code is organised

Everything is in `index.html`, top to bottom:

1. `<head>`: page title, link-preview tags, icons, p5.js and font loading, CSS
2. Name-entry popup (HTML) for new high scores
3. `<script type="module">`: Firebase. Signs in anonymously, listens to the 3
   leaderboard documents, writes a new top-20 list on submit
4. `<script>`: the p5.js game. Key pieces, in order:
   - Settings and state (`DEPLOY_VERSION`, `PIXEL_FONT`, timing constants)
   - `Sfx`: synthesised sound effects
   - `setup()` / `draw()`: p5 entry points. `draw()` runs every frame and
     switches on `gameState`: `loading`, `start`, `ready`, `play`, `paused`,
     `over`, `entering_name`, `leaderboard`
   - Screens: `drawStartScreen`, `drawReadyScreen`, `drawGameOverScreen`,
     `drawLeaderboardScreen`
   - Rules: `modeDifficulty` (speed and gap per mode, ramps with score),
     `playGame` (one 1/60s physics step), `endGame`, `medalFor`
   - Input: `mousePressed` (also fires for taps), `keyPressed`, `handleInput`
   - Classes: `Bird`, `Pipe`, `PowerUp` (shield), `LaserBar` (STACKED hazard),
     plus visual effects

### Things that will bite you

- **Always use `textFont(PIXEL_FONT)`**, never `textFont('Press Start 2P')`.
  The unquoted name is invalid in a canvas font and silently falls back to tiny
  text. `check.sh` catches this.
- **Game speed is tied to `playGame()` running 60 times a second**, not to the
  screen's frame rate. Anything that should move at game speed belongs in
  `playGame()` or uses `simFrame`, not `frameCount`.
- **Leaderboard writes replace the whole top-20 list.** Never write to a board
  whose data hasn't loaded (`received[mode]` guards this).
- **Mobile first.** Size things relative to `width`/`height`, use
  `fitTextSize()` for text that could be wide, keep buttons at least 42px tall.
- **Bump the version on every deploy** or the deploy script will stop you.
- **Keep `"**/.*/**"` in `firebase.json`'s ignore list.** Firebase's default
  `"**/.*"` hides dot-files but not the contents of the `.git` folder, so
  without it every deploy tries to publish the git internals. A correct deploy
  uploads 15 files: `index.html`, the 8 `assets/`, `og-image.jpg`, 4 icons and
  `manifest.webmanifest`.

---

## Local preview (optional)

```bash
python3 -m http.server 8765    # from the repo folder
# open http://localhost:8765
```

The leaderboard works locally too; it talks to the live Firestore, so test
scores you submit are real.
