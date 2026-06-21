# Commander Cosmo — Galactic Pogo Patrol

A finished, self-contained side-scrolling platformer in the classic *Commander Keen*
style (helmet kid + raygun + pogo stick). 100% original art and audio, generated in
code — no external assets, no build step, no dependencies.

## Play it
Double-click **`index.html`** (or open it in any modern browser). That's it.
Click once or press any key to enable sound (browser autoplay rule).

## Controls
| Action | Keys |
|---|---|
| Move | ← → or A / D |
| Jump | Space, ↑, or W (hold for higher) |
| Shoot raygun | Z or Ctrl |
| Pogo stick (toggle) | X or Shift — hold Jump on a bounce for a **super-bounce** |
| Pause | P or Esc |
| Music on/off (off by default) | M |
| Mute all sound | N |
| Confirm / start | Enter |

Mobile: on-screen touch buttons appear automatically.

## The game
- **3 hand-built levels** across 3 themes — Verdant Outpost (surface), Crystal Caves,
  and Iron Fortress — each with their own parallax backdrops and palette.
- **Pogo stick** signature mechanic, variable-height jumps, coyote-time and jump-buffer
  for tight, forgiving feel.
- **Raygun** with limited ammo (collect more); stun/defeat three enemy types
  (Yorp walkers, fast Bloogs, sine-wave Flyers).
- **Hearts + lives** system, instant-death spikes and pits, knockback + i-frames.
- Gems (+100), big gems (+500), ammo packs, 1-up tokens. Collect every gem in a level
  for a **PERFECT +1000** bonus.
- Title / level cards / pause / death / level-clear / game-over / victory screens.
- Chiptune music loop + procedural sound effects (WebAudio).
- Screen shake, particles, landing dust, sparkles, confetti victory.
- High score saved in `localStorage`.

## Tech
- `index.html` — shell, styling, on-screen touch controls.
- `game.js` — the entire game (engine, physics, levels, art, audio).
- Renders to a 320×208 pixel backbuffer, integer-scaled with nearest-neighbor for crisp pixels.
- Fixed-timestep (60 Hz) physics with an accumulator, so it runs the same on any refresh rate.

## Legal
This is an **homage**, not a reproduction. The hero, enemies, music, and art are all
original works created for this project. "Commander Keen" is a trademark of id Software;
this game is not affiliated with or endorsed by them.
