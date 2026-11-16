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

1. Fly in 3D space (mouse steers, `W/S` throttle, `A/D` yaw assist, `SPACE` lasers).
   Pitch + yaw only, with auto-level — the ship can't end up upside-down.
   Lasers fire toward the crosshair (converging camera ray).
2. Shoot asteroids → collect floating ore. Fight pirates. Earn credits.
3. Targeting: hover the crosshair over an object to see its bracket + info panel
   (name / type / distance / value). Hold the crosshair on a target to **lock on** —
   a progress ring fills around the crosshair and a chirp confirms the lock.
   The **Target Scanner** upgrade speeds it up (L1 = 3.0s → L5 = 0.5s).
4. Dock at the central station (`E` when prompted):
   - **SHIPYARD** tab — sell raw cargo, buy medkits & ship upgrades
     (weapon / engine / hull / shield / scanner).
   - **TRADE** tab — commodity exchange (Food, Tech, Med Supplies, Luxury Goods).
     Every market prices differently; buy low, fly, sell high.
5. Fly near a planet, press `E` to land.
6. On the surface (2D top-down): `WASD` walk, `SPACE`/click to shoot — the survivor
   **auto-aims at the nearest hostile**, `E` to chop trees / mine crystals / talk to
   traders, `H` for medkit. Colonist outposts also run a commodity exchange.
7. Press `R` near your landed ship to take off again.

## Galaxy Map
- Press `TAB` in space to open the **galaxy map**: 3 star systems, 9 bodies —
  Orion Reach (Orion Station, Terra Prime, Verdant), Krell Expanse (Krell
  Depot, Krell Prime, Ashfall) and Novara Spur (Novara Gate, Novara, Umbra).
- Click **JUMP** for a direct hyperjump to any body's arrival pad — no
  stargates, no scanning required. Blocked while hostiles are within 700u.

## Stations: Equipment · Market · Missions
- **EQUIPMENT** — medkits, the five ship upgrades, and the **module bay**:
  buy modules (Cargo Pod +20 hold, Retrieval Beam ore magnet, Passenger
  Module, EMP Emitter, Turret Array +6 dmg), install up to 3 slots,
  uninstall back to the ship's module hold (5 spare max), or sell spares.
- **MARKET** — sell raw cargo + the commodity exchange. **Procedural
  economy:** every visit reshuffles all market prices (±15% around their
  base spread), so trade routes stay profitable but no two visits price
  the same. Terra, Verdant & Novara colonists trade too.
- **MISSIONS** — the station lounge spawns 3 random NPCs per visit offering
  procedurally generated contracts:
  - **Cargo delivery** — buy/haul goods to a destination market
  - **Passenger ferry** — requires the Passenger Module installed
  - **Pirate bounty** — destroy N Void Raiders
  - **EMP disable** — non-lethal: fit the EMP Emitter, press `F` to pulse
    (280u radius) and disable raiders without killing them
  3 contracts max; completion pays automatically on arrival / kill / disable.

## Quick Travel
- Fully scan a planet or station (lock ring completes) and a prompt appears:
  **press `Q` to warp** straight to it — twin-engine spool, speed streaks, synced
  v²/2a braking, and an arrival right at the landing pad.
- Warp is **blocked while hostiles are within 700u** — clear the sector first.

## Feel & Fidelity
- Smooth thrust: the throttle spools up over ~0.5s; twin engine flames, plume
  glow and particle trails all scale with throttle.
- The hull visually banks into turns and relaxes when you level out.
- Dynamic lighting: colored nebula wash lights brighten dark sectors, a ship
  headlight reads nearby rocks, and pirates carry blinking red beacons, halos
  and point lights so they're visible against any backdrop.
- Seamless transitions: camera swoop + exhaust burst on (re)entry, white
  descent flash while landing, drifting cloud shadows and dust motes on foot.
- Performance: shared geometries/materials and pooled particles keep the frame
  time flat; pixel ratio capped for stable framerates.

## Planets

| Planet | Type | Notes |
|---|---|---|
| Terra Prime | Peaceful | Trade hub, NPC merchant, wood |
| Verdant | Mixed | Wood + crystals, light alien activity |
| Krell Prime | Hostile | Crystal-rich, alien swarms |
| Ashfall | Hostile | Rich ore, aggressive spitters |

## Tech

Plain HTML5 + Canvas + vanilla JS. Three.js (r128) for the 3D mode, stored
locally in `lib/`. All graphics are procedurally generated in code — canvas
textures for rocky asteroids, planet surfaces & cloud shells, a nebula
starfield dome, particle engine trails and glow effects; all audio is
synthesized with the Web Audio API. No external URLs, no image/model/audio
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
