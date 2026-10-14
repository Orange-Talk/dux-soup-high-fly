# Changelog

Every release of Dux-Soup High Fly. Newest first.

Rules (enforced by `scripts/check.sh`):

- The newest `## [x.y.z]` heading here must equal `DEPLOY_VERSION` in `index.html`.
- That same number shows in the bottom-right corner of the game's home screen.
- Version numbers: bump the last digit for fixes (1.14.0 to 1.14.1), the middle
  digit for new features (1.14.1 to 1.15.0), the first digit for a rebuild.

---

## [1.14.0] - 2026-10-13

Mobile-first overhaul. Almost everyone plays on a phone browser.

### Fixed
- Game ran at double speed on 120Hz phones (recent iPhones, most flagship
  Androids). Physics now runs in fixed 60 steps per second on every device,
  and catches up on slow phones instead of slowing down.
- Pixel-font text ("Game Over", score, leaderboard, titles) was rendering as
  tiny 12px sans-serif. The font name must be quoted in a canvas font string;
  every call now uses the `PIXEL_FONT` constant. Fonts are also preloaded.
- Long titles and scores ran off the edges of narrow phones. Text now shrinks
  to fit.
- Rotating the phone or the browser toolbar hiding mid-run snapped the duck to
  the middle of the screen. The scene now rescales in place.
- If the leaderboard was slow to load, the game sat on "Loading..." forever.
  It now starts after 4.5 seconds regardless.
- Data-safety fix: a score could be written to a leaderboard that had not
  loaded yet, replacing the whole board with one entry. The game now only
  offers a leaderboard entry once that board has actually loaded.
- localStorage access is wrapped so private browsing can't crash the game.

### Added
- "Tap to flap" ready screen. The duck waits for the first tap instead of
  falling immediately.
- Auto pause when switching apps, locking the phone or rotating; pause button
  in the top-right during play; tap anywhere to resume.
- Share Score button on the game-over screen (phone share sheet, or copies the
  text and link on desktop).
- Synthesised sound effects (no audio files) with a mute button top-left,
  remembered per device. Light vibration on pickups and crashes (Android).
- "NEW PERSONAL BEST!" on the game-over screen.
- Skip button on the high-score name entry.
- Link previews: `og-image.jpg` (1200x630) plus Open Graph and Twitter tags, so
  shared links show the High Fly card in iMessage, WhatsApp, Slack, LinkedIn, X.
- Favicon, home-screen icons and `manifest.webmanifest` (Add to Home Screen
  opens full-screen).

### Changed
- Game-over screen now has four buttons: Fly Again, Share Score, mode switch,
  Leaderboard. Larger minimum tap targets throughout.
- Canvas renders at max 2x pixel density (was up to 3x) for smoother play on
  mid-range phones.

## [1.13.0] - 2026-08-19

- RUSH mode renamed to STACKED everywhere (button, leaderboard tab, best score).
  Old RUSH personal bests carry over.

## Before 1.13.0

Not tracked. Older builds are kept for reference in `Duxsoupgame prev builds/`.
