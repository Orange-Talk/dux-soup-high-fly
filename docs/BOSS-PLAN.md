# Boss fight plan: The Tycoon vs Mech Dux (STACKED)

Status: **designed, not built yet.** Target release: a future minor version
(1.17.0 or later). This file is the spec to build from.

## The art

| File | What it is |
|---|---|
| `docs/boss/tycoon-original.png` | Scott's original art, as supplied ("Smug tycoon in a hovering pod") |
| `docs/boss/tycoon-cutout.png` | Same art, background removed (transparent), cropped to the character. 1189x1053 |
| `docs/boss/tycoon-cutout-half.png` | Half size, pixel-perfect (nearest-neighbour) for quicker previews |

`docs/` is excluded from deploys in `firebase.json`. When the boss is built,
copy the final sprite(s) into `assets/boss/` and add them to the required-file
list in `scripts/check.sh`.

### Art change still to make before shipping

The front of the pod has an "Ln" rounded-square badge that reads as the real
LinkedIn logo. Decision (Scott, 2026-10-14): leave it for now, swap it before
the boss ships. Options: a gold crosshair, a "$", or "#OPENTOHUNT". Everything
else in the art stays.

## How the fight works

Only in **STACKED**. One-tap controls stay exactly the same.

1. **Trigger.** At a set STACKED score (start around 400), lasers stop, the
   pipes clear, the screen flashes and a "BOSS INCOMING" banner shows.
2. **Mech Dux.** The duck transforms: same silhouette, all metal, glowing red
   eye, a cannon on the front. Same hitbox as the normal duck.
   - **3 hit points**, shown as 3 pips near the score. The existing shield
     still blocks one hit on top of that.
   - **Auto-fire.** The cannon shoots straight ahead on a timer. The player
     only flaps to dodge, so nothing new to learn on a phone.
3. **The Tycoon** hovers on the right side, bobbing, with a health bar across
   the top of the screen. His attacks:
   - **Rocket launcher (main attack):** a sniper crosshair tracks the duck
     (yellow, dashed), locks (turns red, beeps), then a missile flies to the
     locked spot and explodes with a blast radius. If the duck has moved, it
     is safe. Same "see it, then dodge it" fairness as the STACKED lasers.
   - **Claw swipe:** a pod arm swings down across one lane, telegraphed.
   - **Coin spray:** a fan of gold coins, slow, readable.
4. **Win.** His health hits zero: the pod sputters, he spins off screen in a
   shower of coins. Big bonus to the STACKED score (and leaderboard). Mech
   Dux turns back into the normal duck, pipes return.
5. **He comes back tougher** each time: faster lock-on, then two missiles,
   then shorter gaps between attacks.
6. **Lose.** Mech Dux at 0 hit points = normal game over screen.

## Build notes for whoever implements it

- Follow `CLAUDE.md` and `README.md`: version bump, CHANGELOG entry,
  `scripts/check.sh`, phone-size test, deploy via `scripts/deploy.sh`.
- All boss timing goes in `playGame()` using `simFrame`, so it stays fair at
  any frame rate and scales correctly with Rainbow Dux (1.5x).
- Draw the boss sprite with image smoothing off (it is pixel art), like the
  8-Bit duck skin.
- Mech Dux needs a Day and a magenta version only if it can appear outside
  STACKED; inside STACKED one metal version is enough.
- Keep missiles and claws telegraphed for at least ~0.75 seconds so phone
  players can react.
