# Dux-Soup High Fly — handoff notes

A small browser game (Flappy-Bird style, flying the Dux-Soup duck) intended as a
hidden easter egg inside the Dux-Soup platform.

Play the current build: https://highflygame-1ac8f.web.app

---

## 1. What the game actually is

Two things, and nothing else:

| Path | Size | What it is |
|------|------|------------|
| `index.html` | ~76 KB | The entire game — markup, styles and all game code in one file |
| `assets/` | ~368 KB | 8 PNGs (duck, magenta duck, title, sun, moon, 3 clouds) |

**~440 KB total. Fully static.** No build step, no bundler, no server-side code,
no npm install. Copy those two things onto any web server and the game runs.

`firebase.json` and `.firebaserc` are only needed if you keep deploying to
Firebase Hosting; they are not part of the game.

### Runtime dependencies

Loaded from public CDNs at page load:

- **p5.js 1.4.2** (`cdnjs.cloudflare.com`) — the graphics/game loop library
- **Google Fonts** — "Press Start 2P" and "Inter"

> If the Dux-Soup platform enforces a strict Content-Security-Policy, these two
> may be blocked. Fix is straightforward: download both and serve them from the
> platform, then update the two `<script>`/`<link>` tags at the top of
> `index.html`. Nothing else changes.

---

## 2. Where everything currently lives

Everything is on **personal** accounts (`scott@orange-talk.com`), **not** on any
Dux-Soup company account:

| Thing | Location | Notes |
|-------|----------|-------|
| Source code | GitHub `Orange-Talk/dux-soup-high-fly` | Currently **public** |
| Hosting | Firebase Hosting, project `highflygame-1ac8f` | serves the `.web.app` URL |
| Leaderboard data | Cloud Firestore, same project | day / midnight / rush boards |
| Player sign-in | Firebase Anonymous Auth, same project | no accounts, no personal data |

### ⚠️ The main decision before launch

The Firebase config is embedded in `index.html`. If the game is hosted on the
Dux-Soup platform **without changing it**, scores will still be written into a
personal Firebase project. That means a company feature would depend on a
personal account for its uptime and billing, and would break if that project or
account were ever removed.

Pick one of the options in §3 before shipping.

---

## 3. Options for the leaderboard

### Option A — Dux-Soup owns a Firebase project *(recommended if you want shared leaderboards)*

1. Create a Firebase project on a Dux-Soup account.
2. Enable **Anonymous Authentication** and **Cloud Firestore**.
3. Replace the `firebaseConfig` block near the top of the `<script type="module">`
   in `index.html` (6 lines) with the new project's config.
4. Update the `appId` constant just below it — it is used in the Firestore path.
5. Apply Firestore rules limiting access to the leaderboard documents only
   (see §4).
6. Optionally migrate existing scores (see §5).

Effort: well under an hour for anyone who has used Firebase.

### Option B — Drop the shared leaderboard entirely *(simplest to embed)*

The game already keeps a **personal best per mode in the browser's
localStorage**, independent of Firebase. Removing the Firebase module script and
the Leaderboard button leaves a 100% static game with **zero backend and zero
accounts** — nothing to own, nothing to secure, nothing to pay for.

Best choice if the easter egg is meant to be a bit of fun rather than a
competition.

### Option C — Keep pointing at the personal project

Works today with no changes, but see the warning in §2. Fine for a demo to the
CEO; not appropriate for a shipped feature.

---

## 4. Security notes

- Firestore rules are **already scoped**: an anonymous client cannot read or
  write arbitrary paths, only the game's leaderboard documents. Verified by
  probing the live project.
- The leaderboard document **is writable from the browser**, which is inherent to
  a leaderboard with no backend. Anyone who reads the page source could in
  principle forge or clear scores. Acceptable for an easter egg; do not treat
  the board as authoritative. Eliminating this would require writing scores
  through a server/Cloud Function instead.
- The game collects **no personal data**. Sign-in is anonymous; the only stored
  value is a player-typed display name (max 10 characters) alongside a score.
- The Firebase API key in `index.html` is a client identifier, not a secret —
  Firebase is designed for it to be public. Access is controlled by the
  Firestore rules, not by hiding the key.

---

## 5. Migrating existing scores (only needed for Option A)

Scores live at these Firestore document paths:

```
artifacts/highflygame-1ac8f/public/data/leaderboard/day_mode
artifacts/highflygame-1ac8f/public/data/leaderboard/night_mode
artifacts/highflygame-1ac8f/public/data/leaderboard/rush_mode
```

Each document holds a single `scores` array of up to 20 entries:

```json
{ "scores": [ { "name": "FTW", "score": 4245, "mode": "day" } ] }
```

Copy the three documents into the new project (Firebase console export/import,
or a short script). Or start fresh — it is a game.

---

## 6. Embedding it in the Dux-Soup platform

The game takes over the **whole viewport** (full-screen canvas) and listens for
space/arrow keys. So:

- **Do** give it its own route — e.g. a hidden `/fly` page — serving
  `index.html` with `assets/` alongside it.
- **Don't** drop it into an existing page as a widget; it will fight the host
  page for layout and keyboard input.
- An `<iframe>` pointing at its own route works fine if you want it to appear
  inside an existing screen.

Deployment is just copying static files — it can be served by whatever already
serves the platform's static assets. No Node process required.

---

## 7. How to hand the code over

Any of these, easiest first:

1. **Transfer the GitHub repo** to a Dux-Soup organisation
   (Settings → General → Transfer ownership). Keeps full history, and the repo
   can be made private in the same place.
2. **Add the developer as a collaborator** if you would rather keep ownership.
3. **Send a zip** of `index.html` + `assets/` — genuinely all that is needed to
   run the game.

---

## 8. Local development

```bash
# from the project folder — any static server works
python3 -m http.server 8765
# then open http://localhost:8765
```

Deploying to the current Firebase project (requires access to it):

```bash
firebase deploy --only hosting
```

The version number shown in the corner of the menu comes from `DEPLOY_VERSION`
near the top of the game script — bump it whenever you deploy so it is obvious
which build is live. `firebase.json` sets the HTML to `no-store` so players
always get the newest build rather than an hour-old cached copy.
