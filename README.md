# Block Clash Duel (source)

A Puzzle Fighter style falling-block versus game starring Nong and Nang.

- Play (web link): https://orange-talk.github.io/dux-soup-high-fly/block-clash/
- The playable build lives on the `gh-pages` branch. This branch holds the source.
- Nothing here touches High Fly (`main` branch, deployed to Firebase).

## Build

```
npm install
node build.mjs                 # Claude artifact build -> dist/index.html (online uses the Claude "room" feature)
node build.mjs --standalone    # web build -> dist/standalone/index.html (online uses PeerJS room codes)
```

To publish the web build, copy `dist/standalone/index.html` to `block-clash/index.html` on the `gh-pages` branch and push.

## Layout

- `src/engine.ts` falling-block rules: rotation kicks, 7-bag, T-spins, combos, garbage, supers
- `src/battle.ts` round flow, fighter reactions, effects, HUD, online state sync
- `src/fighter.ts` character animation state machine
- `src/render.ts` boards, blocks, side panels
- `src/ai.ts` CPU opponent (Rookie to Legend)
- `src/main.ts` menus, character select, settings, results, touch controls, main loop
- `src/net.ts` online via Claude artifact rooms; `src/peernet.ts` online via PeerJS for the web build
- `src/audio.ts` music and synthesized sound effects
- `src/template.html` page shell and styles
- `assets/` sprite atlases, portraits, background, effects, music
- `peerserver.cjs` local PeerJS server, only for testing online locally
