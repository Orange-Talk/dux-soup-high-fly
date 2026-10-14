# Notes for AI assistants working on High Fly

Read README.md first. It is the source of truth for layout, workflow and deploys.

Non-negotiables on every change:

1. Bump `DEPLOY_VERSION` in `index.html` (patch for fixes, minor for features).
2. Add a matching `## [x.y.z] - YYYY-MM-DD` entry at the top of `CHANGELOG.md`.
3. Run `bash scripts/check.sh` and get "All checks passed."
4. Test at phone size (390x844) before committing. Players are on mobile browsers.
5. Commit to `main`, then deploy with `bash scripts/deploy.sh` from Google Cloud
   Shell signed in as scott@orange-talk.com. Never deploy uncommitted code.

Code rules:

- Pixel font: `textFont(PIXEL_FONT)` only.
- Game logic advances in `playGame()` at a fixed 60 steps/sec; use `simFrame`
  for gameplay timing, `frameCount` only for cosmetic animation.
- Use `fitTextSize()` for any text that might be wide on a narrow phone.
- Use `safeGet` / `safeSet` for localStorage.
- Never write a leaderboard document that has not loaded (`received[mode]`).
- Keep it a single static `index.html` + `assets/`. No build step.

The owner is non-technical and prefers plain-English summaries, step-by-step
instructions, and no em dashes in anything written for him.
