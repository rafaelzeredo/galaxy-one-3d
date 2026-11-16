# GALAXY ONE — 3D Space & Planet Survival

A browser game mixing **Galaxy on Fire 2 HD**-style 3D space combat/trading with
**Mini DayZ**-style 2D top-down planetary survival — with aliens instead of zombies.

## Play

Open `index.html` directly, or serve the folder:

```
python3 -m http.server 8000
```

Or play the deployed build on **GitHub Pages** (see repo Settings → Pages).

## Loop

1. Fly in 3D space (mouse steers, `W/S` throttle, `SPACE` lasers).
2. Shoot asteroids → collect floating ore. Fight pirates. Earn credits.
3. Dock at the central station (`E` when prompted) → sell cargo, buy upgrades
   (weapon / engine / hull / shield).
4. Fly near a planet, press `E` to land.
5. On the surface (2D top-down): `WASD` walk, mouse-aim + `SPACE`/click to shoot,
   `E` to chop trees / mine crystals / talk to traders, `H` for medkit.
6. Press `R` near your landed ship to take off again.

## Planets

| Planet | Type | Notes |
|---|---|---|
| Terra Prime | Peaceful | Trade hub, NPC merchant, wood |
| Verdant | Mixed | Wood + crystals, light alien activity |
| Krell Prime | Hostile | Crystal-rich, alien swarms |
| Ashfall | Hostile | Rich ore, aggressive spitters |

## Tech

Plain HTML5 + Canvas + vanilla JS. Three.js (r128) for the 3D mode, stored
locally in `lib/`. All graphics are procedurally generated in code; all audio
is synthesized with the Web Audio API. No external URLs, no image/model/audio
files, no CDNs.

## Files

```
index.html      shell + HUD + menus
style.css       GOF-style sci-fi UI chrome
lib/three.min.js Three.js r128 (local)
js/audio.js     Web Audio synth SFX
js/player.js    shared credits / cargo / upgrades / HP
js/space3d.js   Three.js flight, mining, pirates, docking
js/planet2d.js  top-down survival, harvesting, aliens, trading
js/game.js      state machine, main loop, HUD, transitions
```
