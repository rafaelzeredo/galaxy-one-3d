(function(){
  'use strict';
  // 2D top-down planet mode: Mini DayZ-style survival, harvesting, aliens.
  const WORLD = 2400;

  // Aiming spread (radians) applied when the player is running.
  const MOVEMENT_SPREAD = 0.06;

  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const PALETTES = {
    peaceful: { base: '#3a5f3a', patch1: '#44693f', patch2: '#334f33', sand: '#8a7d55', water: '#2e5a70', tint: 'rgba(20,40,60,0.18)', alien: '#7de07d' },
    mixed:    { base: '#3f6b44', patch1: '#4a7a4b', patch2: '#365a38', sand: '#7d734f', water: '#2e5a70', tint: 'rgba(20,40,60,0.2)',  alien: '#8fe08f' },
    hostile1: { base: '#4b3355', patch1: '#583d63', patch2: '#3c2a46', sand: '#6e5a70', water: '#3d2a50', tint: 'rgba(60,10,40,0.16)',  alien: '#c06bf0' },
    hostile2: { base: '#5a4030', patch1: '#6a4c38', patch2: '#4a3426', sand: '#7d6a4d', water: '#5a3d30', tint: 'rgba(80,20,0,0.18)',     alien: '#ff9d5c' },
    oasis:    { base: '#2f6b5e', patch1: '#3a7a66', patch2: '#285848', sand: '#8a8a5a', water: '#1f7a8a', tint: 'rgba(10,50,55,0.18)',     alien: '#6fe0c8' },
    dark:     { base: '#2c3626', patch1: '#38462f', patch2: '#222c1e', sand: '#5a5a48', water: '#2a3a30', tint: 'rgba(10,20,10,0.28)',     alien: '#a8d85f' }
  };
  // which palette each planet index uses
  const PAL_IDX = ['peaceful', 'mixed', 'hostile1', 'hostile2', 'oasis', 'dark'];

  const PL = {
    active: false, ctx: null,
    state: null,   // per-landing world
    planet: null,
    player: { x: WORLD/2, y: WORLD/2 + 120, aim: 0 },
    fireT: 0, harvest: null, harvestT: 0,
    prompt: '', promptTarget: null,
    hitFlash: 0,
    fx: [], walkT: 0, moving: false, fireFlash: 0,
    recoil: 0,          // current weapon recoil (0 = fully recovered)
    enterFlash: 0, cloudShadows: [], motes: [],

    init(ctx){ this.ctx = ctx; },

    enter(planetIdx){
      this.active = true;
      const PD = window.PD;
      this.planet = window.PLANETS[planetIdx];
      this.pal = PALETTES[PAL_IDX[planetIdx] || 'peaceful'];
      PD.planetIndex = planetIdx;

      // restore or create this planet's persistent surface state
      if(!PD.surfaceStates) PD.surfaceStates = {};
      if(PD.surfaceStates[planetIdx]){
        this.state = PD.surfaceStates[planetIdx];
      } else {
        this.state = this._generate(this.planet, planetIdx);
        PD.surfaceStates[planetIdx] = this.state;
      }
      // park the ship
      if(!this.state.ship){
        this.state.ship = { x: WORLD/2, y: WORLD/2 + 130 };
      }
      const s = this.state.ship;
      this.player.x = s.x;
      this.player.y = s.y + 40;
      this.harvest = null;
      this.bullets = [];
      this.fx = [];
      this.aliens = [];
      // seamless landing: white descent flash + drifting atmosphere
      this.enterFlash = 1;
      this.cloudShadows = [];
      for(let i = 0; i < 4; i++){
        this.cloudShadows.push({
          x: Math.random() * WORLD, y: Math.random() * WORLD,
          r: 260 + Math.random() * 340, squish: 0.45 + Math.random() * 0.2,
          vx: 14 + Math.random() * 20, vy: 6 + Math.random() * 10
        });
      }
      this.motes = [];
      for(let i = 0; i < 26; i++){
        this.motes.push({ x: Math.random() * WORLD, y: Math.random() * WORLD,
          vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8,
          r: 1 + Math.random() * 1.6, ph: Math.random() * 6.28 });
      }
      // respawn initial aliens (surface state keeps harvested nodes but aliens refill)
      const n = Math.round(6 + this.planet.alienRate * 7);
      for(let i = 0; i < n; i++) this._spawnAlien(this.planet.alienRate > 1.2 && Math.random() < 0.3);
      this.spawnT = 14;
      window.GameAudio.land();
      window.Game.uiToast('LANDED — ' + this.planet.name);
    },

    exit(){ this.active = false; },

    _generate(def, idx){
      const rnd = mulberry32(def.seed * 7919);
      // ground texture
      const tex = document.createElement('canvas');
      tex.width = WORLD; tex.height = WORLD;
      const c = tex.getContext('2d');
      c.fillStyle = this.pal.base;
      c.fillRect(0, 0, WORLD, WORLD);
      for(let i = 0; i < 260; i++){
        c.fillStyle = [this.pal.patch1, this.pal.patch2, this.pal.sand][Math.floor(rnd() * 3)];
        c.beginPath();
        c.ellipse(rnd() * WORLD, rnd() * WORLD, 40 + rnd() * 130, 30 + rnd() * 90, rnd() * 3, 0, 6.283);
        c.fill();
      }
      for(let i = 0; i < 14; i++){
        c.fillStyle = this.pal.water;
        c.beginPath();
        c.ellipse(rnd() * WORLD, rnd() * WORLD, 40 + rnd() * 70, 30 + rnd() * 50, rnd() * 3, 0, 6.283);
        c.fill();
      }
      for(let i = 0; i < 400; i++){
        c.fillStyle = 'rgba(0,0,0,' + (0.05 + rnd() * 0.08).toFixed(2) + ')';
        c.fillRect(rnd() * WORLD, rnd() * WORLD, 2 + rnd() * 4, 2 + rnd() * 4);
      }

      // baked flora layer: grass tufts, pebbles, flowers / glowing spores
      const hostile = def.type === 'hostile';
      for(let i = 0; i < 2100; i++){
        const x = rnd() * WORLD, y = rnd() * WORLD;
        c.strokeStyle = hostile ? 'rgba(20,10,26,0.3)' : 'rgba(220,255,220,0.16)';
        c.lineWidth = 1;
        for(let b = -1; b <= 1; b++){
          c.beginPath();
          c.moveTo(x, y);
          c.quadraticCurveTo(x + b * 3, y - 4, x + b * 5 + (rnd() - 0.5) * 3, y - 6 - rnd() * 7);
          c.stroke();
        }
      }
      for(let i = 0; i < 700; i++){
        c.fillStyle = 'rgba(0,0,0,' + (0.08 + rnd() * 0.12).toFixed(2) + ')';
        c.beginPath();
        c.ellipse(rnd() * WORLD, rnd() * WORLD, 1.5 + rnd() * 3, 1 + rnd() * 2, rnd() * 3, 0, 6.283);
        c.fill();
      }
      const flowerCols = ['#e8c95f', '#d97f9e', '#9fd8e8', '#c9e05f'];
      for(let i = 0; i < 260; i++){
        const x = rnd() * WORLD, y = rnd() * WORLD;
        if(hostile){
          // glowing alien spores
          c.fillStyle = this.pal.alien;
          c.globalAlpha = 0.22 + rnd() * 0.2;
          c.beginPath(); c.arc(x, y, 2 + rnd() * 3, 0, 6.283); c.fill();
          c.globalAlpha = 1;
        } else {
          c.fillStyle = flowerCols[Math.floor(rnd() * flowerCols.length)];
          c.beginPath(); c.arc(x, y, 1.6 + rnd() * 1.8, 0, 6.283); c.fill();
          c.fillStyle = 'rgba(0,0,0,0.25)';
          c.fillRect(x - 0.5, y + 1.5, 1, 4);
        }
      }
      // hostile worlds: cracked, ember-veined ground
      if(hostile){
        for(let i = 0; i < 90; i++){
          const x = rnd() * WORLD, y = rnd() * WORLD;
          c.strokeStyle = 'rgba(255,110,50,' + (0.08 + rnd() * 0.1).toFixed(2) + ')';
          c.lineWidth = 1.5 + rnd() * 2;
          c.beginPath();
          c.moveTo(x, y);
          let px = x, py = y;
          for(let s = 0; s < 4; s++){
            px += (rnd() - 0.5) * 60; py += (rnd() - 0.5) * 60;
            c.lineTo(px, py);
          }
          c.stroke();
        }
      }
      // border darkness
      c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 90;
      c.strokeRect(-20, -20, WORLD + 40, WORLD + 40);

      const nodes = [];
      const trees = [], rocks = [], crystals = [];
      const placed = [];
      const scatter = (n, arr, minD) => {
        for(let k = 0; k < n; k++){
          let x, y, ok = false, tries = 0;
          while(!ok && tries++ < 30){
            x = 90 + rnd() * (WORLD - 180);
            y = 90 + rnd() * (WORLD - 180);
            ok = true;
            for(const p of placed){
              if((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < minD * minD){ ok = false; break; }
            }
          }
          if(ok){ arr.push({ x, y, hp: 3, seed: rnd() }); placed.push({ x, y }); }
        }
      };
      scatter(def.treeN, trees, 70);
      scatter(def.rockN, rocks, 90);
      scatter(def.crystalN, crystals, 120);
      // nests
      const nests = [];
      scatter(4 + Math.round(def.alienRate * 3), nests, 200);

      return {
        tex, trees, rocks, crystals, nests, nestsR: nests.map(n => ({ x: n.x, y: n.y, t: 8 + Math.random() * 8 })),
        trader: def.trader ? (() => {
          const t = { x: WORLD/2 + 200, y: WORLD/2 - 160 };
          placed.push(t);
          return t;
        })() : null,
        ship: null,
        stats: { wood: 0, ore: 0, crystal: 0, kills: 0 }
      };
    },

    _spawnAlien(spitter){
      // spawn away from player
      let x, y, tries = 0;
      do {
        x = 100 + Math.random() * (WORLD - 200);
        y = 100 + Math.random() * (WORLD - 200);
      } while(tries++ < 20 && Math.hypot(x - this.player.x, y - this.player.y) < 500);
      this.aliens.push({
        x, y, hp: spitter ? 26 : 16, spitter: !!spitter,
        speed: this.alienSpeed(this.planet.alienRate, spitter),
        t: Math.random() * 6, atkT: 0, wob: Math.random() * 6.28
      });
    },

    isNearShip(){
      if(!this.state || !this.state.ship) return false;
      return Math.hypot(this.player.x - this.state.ship.x, this.player.y - this.state.ship.y) < 70;
    },

    // Alien population management (Step 1 Update): baseline pack size scales with
    // the planet's hostility; the cap bounds long-run populations.
    alienBaseline(){
      const rate = this.planet ? this.planet.alienRate : 0;
      return Math.round(6 + rate * 7);
    },
    alienCap(){
      return 14;
    },

    // Alien movement tuning (Living World Update): chasers scale with the
    // planet's hostility so hostile packs pursue at ~player-run speed (or a bit
    // faster, harder to escape by running); spitters keep a slower ranged
    // archetype. Speeds are in world units/second.
    alienSpeed(alienRate, spitter){
      const RUN_SPEED = 150; // player run speed in planet mode
      const v = spitter ? RUN_SPEED * (0.25 + alienRate * 0.25) : RUN_SPEED * (0.5 + alienRate * 0.4);
      return Math.round(v * 10) / 10;
    },

    // Living world: gradual time-based natural regeneration of depleted
    // harvest nodes. Each node remembers when it was depleted (depletedAt);
    // while depleted it recovers over time at a kind-specific rate. Time spent
    // on other planets or in other star systems counts automatically because we
    // measure against wall-clock elapsed time since depletion.
    regenResources(nowMs){
      const PD = window.PD;
      const surfaces = PD ? PD.surfaceStates : null;
      if(!surfaces) return;
      const RATES = { tree: 0.30, rock: 0.05, crystal: 0.025 }; // hp units per second
      const MAX_HP = 3;
      const tickArr = (arr, kind) => {
        if(!arr) return;
        for(const n of arr){
          if(n.hp > 0 || n.depletedAt == null) continue; // only depleted nodes regen
          const rate = RATES[kind] || RATES.rock;
          const elapsed = Math.max(0, (nowMs - n.depletedAt) / 1000);
          const recovered = elapsed * rate;
          if(recovered >= 1){
            n.hp = Math.min(MAX_HP, n.hp + Math.floor(recovered));
          }
        }
      };
      for(const key in surfaces){
        const st = surfaces[key];
        if(!st) continue;
        tickArr(st.trees, 'tree');
        tickArr(st.rocks, 'rock');
        tickArr(st.crystals, 'crystal');
      }
    },

    update(dt){
      if(!this.active) return;
      const G = window.Game, PD = window.PD, inp = G.input;
      const p = this.player;

      // movement
      let dx = 0, dy = 0;
      if(inp.keys.has('KeyW')) dy -= 1;
      if(inp.keys.has('KeyS')) dy += 1;
      if(inp.keys.has('KeyA')) dx -= 1;
      if(inp.keys.has('KeyD')) dx += 1;
      const moving = dx !== 0 || dy !== 0;
      this.moving = moving;
      if(moving) this.walkT += dt;
      if(moving){
        if(this.harvest){ this.harvest = null; } // moving cancels harvesting
        const l = Math.hypot(dx, dy);
        const sp = 150;
        p.x = Math.max(60, Math.min(WORLD - 60, p.x + dx / l * sp * dt));
        p.y = Math.max(60, Math.min(WORLD - 60, p.y + dy / l * sp * dt));
      }

      // aim: auto-target the nearest hostile in range, else face the cursor
      // (mouse is in screen coords — convert to world via the camera offset)
      const vwU = this.ctx.canvas.width, vhU = this.ctx.canvas.height;
      const camXu = Math.max(vwU/2, Math.min(WORLD - vwU/2, p.x));
      const camYu = Math.max(vhU/2, Math.min(WORLD - vhU/2, p.y));
      const mouseWX = inp.mouseWorldX + (camXu - vwU/2);
      const mouseWY = inp.mouseWorldY + (camYu - vhU/2);
      const shooting = inp.mouseDown || inp.keys.has('Space');
      let aimTarget = null, aimDist = 420;
      if(shooting){
        for(const al of this.aliens){
          const d = Math.hypot(al.x - p.x, al.y - p.y);
          if(d < aimDist){ aimDist = d; aimTarget = al; }
        }
      }
      if(aimTarget){
        // lead the shot along the alien's heading (chasers run at the player)
        const tFly = aimDist / 420;
        const hold = aimTarget.spitter && aimDist < 180;
        const hvx = hold ? 0 : Math.cos(Math.atan2(p.y - aimTarget.y, p.x - aimTarget.x)) * aimTarget.speed;
        const hvy = hold ? 0 : Math.sin(Math.atan2(p.y - aimTarget.y, p.x - aimTarget.x)) * aimTarget.speed;
        p.aim = Math.atan2(aimTarget.y + hvy * tFly - p.y, aimTarget.x + hvx * tFly - p.x);
      } else {
        p.aim = Math.atan2(mouseWY - p.y, mouseWX - p.x);
      }

      // shoot
      this.fireT -= dt;
      const w = WEAPON_DEFS[window.PD.equippedWeapon];
      if(w){
        // Recoil gradually recovers over time, even while running or not firing
        this.recoil = Math.max(0, this.recoil - dt * w.recoilRecovery);
      }
      if(shooting && this.fireT <= 0){
        if(w && window.PD.energyCells > 0){
          this.fireT = w.delay;
          window.PD.energyCells--;
          this.fireFlash = 0.08;
          // Add recoil from this shot, capped at max
          this.recoil = Math.min(w.maxRecoil, this.recoil + w.recoilPerShot);
          // Total aiming spread = weapon baseline + movement penalty + recoil
          const moveSpread = this.moving ? MOVEMENT_SPREAD : 0;
          const totalSpread = w.baseSpread + moveSpread + this.recoil;
          // Apply random angular spread to the aim direction
          const spreadAngle = (Math.random() - 0.5) * 2 * totalSpread;
          const shotAim = p.aim + spreadAngle;
          this.bullets.push({
            x: p.x + Math.cos(shotAim) * 14, y: p.y + Math.sin(shotAim) * 14,
            vx: Math.cos(shotAim) * 420, vy: Math.sin(shotAim) * 420,
            life: w.range / 420, friendly: true, dmg: w.dmg
          });
          this._spawnFx(p.x + Math.cos(shotAim) * 18, p.y + Math.sin(shotAim) * 18, '#aef2ff', 2, 60, 1.6, true, 0.25);
          window.GameAudio.shoot2d();
        }
      }

      // fx particles (chips, goo, sparks)
      for(let i = this.fx.length - 1; i >= 0; i--){
        const f = this.fx[i];
        f.life -= dt;
        if(f.life <= 0){ this.fx.splice(i, 1); continue; }
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.vx *= (1 - 2.5 * dt); f.vy *= (1 - 2.5 * dt);
      }
      if(this.fireFlash > 0) this.fireFlash -= dt;

      // bullets
      for(let i = this.bullets.length - 1; i >= 0; i--){
        const b = this.bullets[i];
        b.life -= dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if(b.life <= 0){ this.bullets.splice(i, 1); continue; }
        if(b.friendly){
          for(let a = this.aliens.length - 1; a >= 0; a--){
            const al = this.aliens[a];
            if(Math.hypot(al.x - b.x, al.y - b.y) < 16){
              al.hp -= b.dmg || 12;
              this.bullets.splice(i, 1);
              this._spawnFx(b.x, b.y, this.pal.alien, 4, 95, 2.2, true, 0.4);
              window.GameAudio.laserHit();
              if(al.hp <= 0){
                this.aliens.splice(a, 1);
                this.state.stats.kills++;
                this._spawnFx(al.x, al.y, this.pal.alien, 12, 130, 3, true, 0.6);
                this._spawnFx(al.x, al.y, '#0e0a12', 5, 70, 2.4, false, 0.5);
                window.GameAudio.alienDie();
                const roll = Math.random();
                if(roll < 0.55) this._give('goo', 1);
                else if(roll < 0.65) this._give('crystal', 1);
              }
              break;
            }
          }
        } else {
          if(Math.hypot(p.x - b.x, p.y - b.y) < 14){
            this.bullets.splice(i, 1);
            this._hurt(9);
          }
        }
      }

      // aliens AI
      for(const al of this.aliens){
        al.t += dt;
        const d = Math.hypot(p.x - al.x, p.y - al.y);
        if(d < 300){
          const ang = Math.atan2(p.y - al.y, p.x - al.x);
          if(al.spitter){
            if(d > 180){
              al.x += Math.cos(ang) * al.speed * dt;
              al.y += Math.sin(ang) * al.speed * dt;
            } else {
              al.atkT -= dt;
              if(al.atkT <= 0){
                al.atkT = 2.2;
                this.bullets.push({ x: al.x, y: al.y, vx: Math.cos(ang) * 240, vy: Math.sin(ang) * 240, life: 1.2, friendly: false });
                window.GameAudio.alienHiss();
              }
            }
          } else {
            al.x += Math.cos(ang) * al.speed * dt;
            al.y += Math.sin(ang) * al.speed * dt;
            al.atkT -= dt;
            if(d < 24 && al.atkT <= 0){
              al.atkT = 0.9;
              this._hurt(al.spitter ? 10 : 8 + this.planet.alienRate * 3);
              // always-active melee: player inflicts damage on contact, no weapon or ammo needed
              al.hp -= 8;
              if(al.hp <= 0){
                this.aliens.splice(this.aliens.indexOf(al), 1);
                this.state.stats.kills++;
                this._spawnFx(al.x, al.y, this.pal.alien, 12, 130, 3, true, 0.6);
                this._spawnFx(al.x, al.y, '#0e0a12', 5, 70, 2.4, false, 0.5);
                window.GameAudio.alienDie();
                const roll = Math.random();
                if(roll < 0.55) this._give('goo', 1);
                else if(roll < 0.65) this._give('crystal', 1);
              }
            }
          }
        } else {
          al.wob += dt;
          al.x += Math.cos(al.wob * 0.7) * 18 * dt;
          al.y += Math.sin(al.wob * 0.55) * 18 * dt;
        }
        al.x = Math.max(40, Math.min(WORLD - 40, al.x));
        al.y = Math.max(40, Math.min(WORLD - 40, al.y));
      }

      // gradual alien respawn: time-based repopulation toward the planet's
      // baseline population while under the per-planet cap (never instant, never
      // above the cap; refills after kills and on revisit via enter()).
      this.spawnT -= dt;
      const alienFloor = Math.min(this.alienCap(), Math.max(0, this.alienBaseline()));
      if(this.spawnT <= 0){
        this.spawnT = Math.max(2, 14 - this.planet.alienRate * 2);
        if(this.aliens.length < alienFloor && this.aliens.length < this.alienCap()){
          const nest = this.state.nestsR[Math.floor(Math.random() * this.state.nestsR.length)];
          if(nest){
            this._spawnAlien(false);
          }
        }
      }

      // harvesting / interaction target
      let target = null, kind = '';
      const st = this.state;
      const near = (arr, r) => {
        let best = null, bd = r;
        for(const n of arr){
          if(n.hp <= 0) continue;
          const d = Math.hypot(n.x - p.x, n.y - p.y);
          if(d < bd){ bd = d; best = n; }
        }
        return best;
      };
      let prompt = '';
      if(st.trader && Math.hypot(st.trader.x - p.x, st.trader.y - p.y) < 60){
        prompt = 'Press <b>E</b> to trade with the <b>Colonist</b>';
        target = st.trader; kind = 'trader';
      } else {
        let node = near(st.crystals, 46);
        if(node){ kind = 'crystal'; }
        else { node = near(st.trees, 46); if(node) kind = 'tree'; }
        if(!node){ node = near(st.rocks, 46); if(node) kind = 'rock'; }
        if(node){
          const names = { crystal: 'mine Krell Crystal', tree: 'chop Hardwood', rock: 'mine Iron Ore' };
          prompt = 'Hold position and press <b>E</b> to ' + names[kind];
          target = node;
        }
      }
      if(this.isNearShip()){
        prompt = 'Press <b>R</b> to <b>take off</b>' + (prompt ? ' · ' + prompt.replace(/<\/?b>/g, '') : '');
      }
      this.prompt = prompt;

      // harvest logic (must hold E, stay near)
      if(inp.keys.has('KeyE') && target && kind !== 'trader'){
        if(this.harvest !== target){
          this.harvest = target; this.harvestT = 0;
        }
        this.harvestT += dt;
        const need = kind === 'crystal' ? 1.8 : kind === 'tree' ? 1.3 : 1.6;
        if(Math.hypot(target.x - p.x, target.y - p.y) > 55){
          this.harvest = null;
        } else {
          if(Math.random() < dt * 8){
            if(kind === 'tree') window.GameAudio.chop(); else window.GameAudio.mineHit();
            const chipCol = kind === 'tree' ? '#8a6a3a' : kind === 'rock' ? '#9aa8bb' : '#5ff0ff';
            this._spawnFx(target.x, target.y, chipCol, 2, 75, 2, kind === 'crystal', 0.4);
          }
          if(this.harvestT >= need){
            target.hp--;
            this.harvestT = 0;
            const burstCol = kind === 'crystal' ? '#5ff0ff' : kind === 'tree' ? '#4d6a50' : '#9aa8bb';
            this._spawnFx(target.x, target.y, burstCol, 8, 115, 2.6, kind === 'crystal', 0.55);
            if(kind === 'crystal') this._give('crystal', 2);
            else if(kind === 'tree') this._give('wood', 2);
            else this._give('ore', 2);
            if(target.hp <= 0){
              target.depletedAt = Date.now(); // mark depletion so resources regrow over time
              if(kind === 'crystal') this._give('crystal', 1);
              this._spawnFx(target.x, target.y, burstCol, 14, 140, 3, true, 0.7);
              this.harvest = null;
            }
          }
        }
      } else if(!inp.keys.has('KeyE')){
        this.harvest = null;
      }

      if(inp.pressed('KeyR') && this.isNearShip()){
        window.Game.takeOff();
        return;
      }
      if(inp.pressed('KeyH')) this._useMedkit();
      if(inp.pressed('KeyE') && target && kind === 'trader'){
        window.Game.openTrade();
      }
      // weapon switching: G cycles between owned weapons; 1/2 select directly
      if(inp.pressed('KeyG') && window.PD.weapons.length >= 2){
        const w = window.PD;
        const idx = w.weapons.indexOf(w.equippedWeapon);
        const next = idx >= 0 ? w.weapons[(idx + 1) % w.weapons.length] : w.weapons[0];
        w.equipWeapon(next);
      }
      if(inp.pressed('Digit1') && window.PD.hasWeapon('laserpistol')){ window.PD.equipWeapon('laserpistol'); }
      if(inp.pressed('Digit2') && window.PD.hasWeapon('assaultrifle')){ window.PD.equipWeapon('assaultrifle'); }

      if(this.hitFlash > 0) this.hitFlash -= dt;
      if(this.enterFlash > 0) this.enterFlash = Math.max(0, this.enterFlash - dt * 1.1);
      // ambient drift: cloud shadows + dust motes (cheap, wraps in world space)
      for(const cs of this.cloudShadows){
        cs.x += cs.vx * dt; cs.y += cs.vy * dt;
        if(cs.x > WORLD + cs.r) cs.x = -cs.r;
        if(cs.y > WORLD + cs.r) cs.y = -cs.r;
      }
      for(const m of this.motes){
        m.x += m.vx * dt; m.y += m.vy * dt;
        if(m.x < 0) m.x = WORLD; if(m.x > WORLD) m.x = 0;
        if(m.y < 0) m.y = WORLD; if(m.y > WORLD) m.y = 0;
      }
      if(PD.playerHp <= 0){ window.Game.onPlanetDeath(); return; }
    },

    _useMedkit(){
      if(window.PD.useMedkit()){
        window.GameAudio.uiBuy();
        window.Game.uiToast('MEDKIT USED +55');
      } else {
        window.GameAudio.uiClick();
      }
    },

    // glowing particle burst (harvest chips, alien goo, muzzle sparks)
    _spawnFx(x, y, color, n, speed, r, glow, life){
      for(let i = 0; i < n; i++){
        const a = Math.random() * 6.283;
        const sp = speed * (0.4 + Math.random() * 0.8);
        const l = (life || 0.55) * (0.6 + Math.random() * 0.7);
        this.fx.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: l, maxLife: l, r: (r || 2.2) * (0.6 + Math.random() * 0.8), color, glow: !!glow
        });
      }
      if(this.fx.length > 220) this.fx.splice(0, this.fx.length - 220);
    },

    _give(type, n){
      const got = window.PD.addItem(type, n);
      if(got > 0){
        window.GameAudio.pickup();
        window.Game.uiToast('+' + got + ' ' + window.COMMS[type].name);
      } else {
        window.Game.uiToast('CARGO FULL');
      }
    },

    _hurt(n){
      const PD = window.PD;
      if(this.hitFlash > 0) return;
      PD.playerDmg(n);
      this.hitFlash = 0.5;
      window.GameAudio.hurt();
      this.hitShake = 8;
      this._spawnFx(this.player.x, this.player.y, '#ff5f7a', 6, 90, 2, true, 0.4);
    },

    // ---------- rendering ----------
    render(){
      const ctx = this.ctx;
      if(!this.active || !this.state) return;
      const G = window.Game;
      const vw = ctx.canvas.width, vh = ctx.canvas.height;
      // opaque backdrop covers the entire viewport (incl. beyond-world strips)
      ctx.fillStyle = '#04070d';
      ctx.fillRect(0, 0, vw, vh);
      const p = this.player, st = this.state;
      const camX = Math.max(vw/2, Math.min(WORLD - vw/2, p.x));
      const camY = Math.max(vh/2, Math.min(WORLD - vh/2, p.y));
      const ox = camX - vw/2, oy = camY - vh/2;

      if(this.hitShake > 0){ this.hitShake *= 0.85; if(this.hitShake < 0.5) this.hitShake = 0; }
      const shx = this.hitShake ? (Math.random() - 0.5) * this.hitShake : 0;
      const shy = this.hitShake ? (Math.random() - 0.5) * this.hitShake : 0;

      ctx.save();
      ctx.translate(-ox + shx, -oy + shy);
      ctx.drawImage(st.tex, 0, 0);

      // drifting cloud shadows give the surface living atmosphere
      for(const cs of this.cloudShadows){
        if(cs.x + cs.r < ox || cs.x - cs.r > ox + vw || cs.y + cs.r < oy || cs.y - cs.r > oy + vh) continue;
        ctx.fillStyle = 'rgba(6,10,18,0.13)';
        ctx.beginPath();
        ctx.ellipse(cs.x, cs.y, cs.r, cs.r * cs.squish, 0.4, 0, 6.283);
        ctx.fill();
      }
      // floating dust motes catch the light
      const tn = performance.now() / 1000;
      for(const m of this.motes){
        if(m.x < ox || m.x > ox + vw || m.y < oy || m.y > oy + vh) continue;
        ctx.globalAlpha = 0.25 + 0.2 * Math.sin(tn * 2 + m.ph);
        ctx.fillStyle = '#cfe8ff';
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // nests (glowing brood clusters)
      for(const n of st.nestsR){
        if(n.x < ox - 60 || n.x > ox + vw + 60 || n.y < oy - 60 || n.y > oy + vh + 60) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(n.x + 4, n.y + 8, 27, 12, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#1c141f';
        ctx.beginPath(); ctx.ellipse(n.x, n.y, 26, 18, 0, 0, 6.283); ctx.fill();
        const pulse = 0.5 + 0.3 * Math.sin(performance.now() / 400 + n.x);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = this.pal.alien;
        ctx.globalAlpha = 0.1 * pulse;
        ctx.beginPath(); ctx.ellipse(n.x, n.y, 30, 22, 0, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
        ctx.fillStyle = '#4a2a3a';
        for(let e = 0; e < 3; e++){
          ctx.beginPath(); ctx.ellipse(n.x - 8 + e * 8, n.y - 4 - (e % 2) * 4, 5, 7, 0, 0, 6.283); ctx.fill();
        }
        ctx.fillStyle = this.pal.alien;
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.arc(n.x, n.y - 2, 2.5, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // rocks (ore nodes) — faceted body, sunlit top facet, ore veins, cracks when damaged
      for(const r of st.rocks){
        if(r.x < ox - 40 || r.x > ox + vw + 40 || r.y < oy - 40 || r.y > oy + vh + 40) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(r.x + 6, r.y + 9, 19, 8, 0, 0, 6.283); ctx.fill();
        const dmg = r.hp <= 1;
        ctx.fillStyle = dmg ? '#454a54' : '#5a5f6a';
        ctx.beginPath();
        ctx.moveTo(r.x + 18, r.y);
        ctx.lineTo(r.x + 9, r.y - 15); ctx.lineTo(r.x - 6, r.y - 13);
        ctx.lineTo(r.x - 16, r.y + 2); ctx.lineTo(r.x - 6, r.y + 13); ctx.lineTo(r.x + 6, r.y + 12);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(190,205,225,0.22)'; // sunlit top-left facet
        ctx.beginPath();
        ctx.moveTo(r.x + 9, r.y - 15); ctx.lineTo(r.x - 6, r.y - 13);
        ctx.lineTo(r.x - 8, r.y - 4); ctx.lineTo(r.x + 3, r.y - 6);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; // shaded bottom facet
        ctx.beginPath();
        ctx.moveTo(r.x - 16, r.y + 2); ctx.lineTo(r.x - 6, r.y + 13);
        ctx.lineTo(r.x + 6, r.y + 12); ctx.lineTo(r.x - 2, r.y + 4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8fa0b5';
        ctx.fillRect(r.x - 4, r.y - 8, 5, 5);
        ctx.fillRect(r.x + 4, r.y - 2, 4, 4);
        ctx.fillStyle = '#b8c8dd';
        ctx.fillRect(r.x - 9, r.y + 2, 3, 3);
        if(dmg){
          ctx.strokeStyle = 'rgba(10,12,16,0.7)'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(r.x - 8, r.y - 10); ctx.lineTo(r.x - 2, r.y - 2); ctx.lineTo(r.x + 6, r.y - 6);
          ctx.moveTo(r.x - 4, r.y + 8); ctx.lineTo(r.x + 2, r.y);
          ctx.stroke();
        }
      }

      // trees — layered canopy with sunlit highlights, sway, directional shadow
      for(const t of st.trees){
        if(t.x < ox - 50 || t.x > ox + vw + 50 || t.y < oy - 60 || t.y > oy + vh + 60) continue;
        const sway = Math.sin(performance.now() / 1400 + t.seed * 40) * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(t.x + 6, t.y + 10, 17, 6, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#5a4632';
        ctx.beginPath();
        ctx.moveTo(t.x - 4, t.y + 6); ctx.lineTo(t.x - 2 + sway * 0.4, t.y - 14);
        ctx.lineTo(t.x + 2 + sway * 0.4, t.y - 14); ctx.lineTo(t.x + 4, t.y + 6);
        ctx.closePath(); ctx.fill();
        if(t.hp <= 0){
          ctx.fillStyle = '#3a4a3a';
          ctx.beginPath(); ctx.ellipse(t.x, t.y - 18, 5, 4, 0, 0, 6.283); ctx.fill();
          ctx.strokeStyle = '#2a382f'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(t.x, t.y - 18, 3, 0, 6.283); ctx.stroke();
        } else {
          const g = t.hp === 3 ? 0 : 1;
          const host = this.planet.type === 'hostile';
          const c1 = host ? '#3d5240' : '#2d5231';
          const c2 = host ? '#4d6a50' : '#3d6b40';
          const c3 = host ? '#5f7f60' : '#4f8552';
          ctx.fillStyle = c1;
          ctx.beginPath(); ctx.arc(t.x + sway, t.y - 22, 15 - g * 2, 0, 6.283); ctx.fill();
          ctx.fillStyle = c2;
          ctx.beginPath(); ctx.arc(t.x - 7 + sway + g * 3, t.y - 26, 9 - g, 0, 6.283); ctx.fill();
          ctx.beginPath(); ctx.arc(t.x + 8 + sway, t.y - 24, 7 - g * 0.5, 0, 6.283); ctx.fill();
          ctx.fillStyle = c3; // sunlit crown
          ctx.beginPath(); ctx.arc(t.x - 4 + sway, t.y - 31, 5.5 - g, 0, 6.283); ctx.fill();
        }
      }

      // crystals
      for(const c of st.crystals){
        if(c.hp <= 0) continue;
        if(c.x < ox - 40 || c.x > ox + vw + 40 || c.y < oy - 40 || c.y > oy + vh + 40) continue;
        const pulse = 0.5 + 0.3 * Math.sin(performance.now() / 300 + c.seed * 9);
        ctx.fillStyle = 'rgba(95,240,255,' + (0.15 * pulse).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(c.x, c.y, 18, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#5ff0ff';
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - 12); ctx.lineTo(c.x + 6, c.y);
        ctx.lineTo(c.x, c.y + 9); ctx.lineTo(c.x - 6, c.y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#d9fbff';
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - 12); ctx.lineTo(c.x + 6, c.y); ctx.lineTo(c.x, c.y);
        ctx.closePath(); ctx.fill();
      }

      // trader outpost (tent + striped awning + crates)
      if(st.trader){
        const t = st.trader;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(t.x + 5, t.y + 12, 26, 8, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#3a3040';
        ctx.beginPath();
        ctx.moveTo(t.x - 20, t.y + 12); ctx.lineTo(t.x, t.y - 14); ctx.lineTo(t.x + 20, t.y + 12);
        ctx.closePath(); ctx.fill();
        for(let s2 = 0; s2 < 4; s2++){ // striped awning
          ctx.fillStyle = s2 % 2 ? '#c9a35f' : '#8a6a3a';
          ctx.fillRect(t.x - 20 + s2 * 10, t.y - 8, 10, 4);
        }
        ctx.fillStyle = '#8a6a3a';
        ctx.fillRect(t.x - 21, t.y - 10, 42, 3);
        ctx.fillStyle = '#4a3a2a'; // crates
        ctx.fillRect(t.x - 30, t.y + 2, 9, 9);
        ctx.fillRect(t.x + 22, t.y + 4, 8, 7);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.strokeRect(t.x - 30, t.y + 2, 9, 9);
        ctx.strokeRect(t.x + 22, t.y + 4, 8, 7);
        ctx.fillStyle = '#c9a35f';
        ctx.beginPath(); ctx.arc(t.x, t.y - 20, 6, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#4a5a8a';
        ctx.fillRect(t.x - 5, t.y - 14, 10, 12);
        const bob = Math.sin(performance.now() / 500) * 2;
        ctx.fillStyle = '#ffd479';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('♦ TRADER', t.x, t.y - 34 + bob);
      }

      // landed ship
      if(st.ship){
        const s = st.ship;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(4, 8, 27, 10, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#2a3450'; // landing legs
        ctx.fillRect(-18, 6, 4, 9);
        ctx.fillRect(14, 6, 4, 9);
        ctx.fillStyle = '#c9d4e0';
        ctx.beginPath();
        ctx.moveTo(0, -22); ctx.lineTo(12, 8); ctx.lineTo(0, 16); ctx.lineTo(-12, 8);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(95,240,255,0.25)'; // hull sheen
        ctx.beginPath();
        ctx.moveTo(0, -22); ctx.lineTo(12, 8); ctx.lineTo(4, 8); ctx.lineTo(-2, -20);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#3d5a80';
        ctx.fillRect(-20, 2, 40, 6);
        ctx.fillStyle = '#5ff0ff';
        ctx.beginPath(); ctx.arc(0, -6, 3.4, 0, 6.283); ctx.fill();
        ctx.save(); // engine idle glow
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 + 0.2 * Math.sin(performance.now() / 250);
        ctx.fillStyle = '#5ff0ff';
        ctx.beginPath(); ctx.ellipse(0, 18, 6, 3, 0, 0, 6.283); ctx.fill();
        ctx.restore();
        if(this.isNearShip()){
          ctx.strokeStyle = 'rgba(95,240,255,0.5)';
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.arc(0, 0, 70, 0, 6.283); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      // aliens — segmented bodies, animated legs, glow aura, venom sac for spitters
      for(const al of this.aliens){
        if(al.x < ox - 40 || al.x > ox + vw + 40 || al.y < oy - 40 || al.y > oy + vh + 40) continue;
        const wob = Math.sin(al.t * 9 + al.wob) * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(al.x + 4, al.y + 9, 10, 4, 0, 0, 6.283); ctx.fill();
        // aura
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = this.pal.alien;
        ctx.beginPath(); ctx.arc(al.x, al.y - 2 + wob * 0.3, 15, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
        // legs
        ctx.strokeStyle = 'rgba(10,6,14,0.85)';
        ctx.lineWidth = 2;
        for(let l = 0; l < 4; l++){
          const lx = al.x - 7 + l * 4.5;
          const kick = Math.sin(al.t * 13 + l * 1.7 + al.wob) * 2.5;
          ctx.beginPath();
          ctx.moveTo(lx, al.y + 3);
          ctx.lineTo(lx - 1.5, al.y + 9 + kick);
          ctx.stroke();
        }
        // body: two segments with ridge
        ctx.fillStyle = this.pal.alien;
        ctx.beginPath(); ctx.ellipse(al.x, al.y + wob * 0.4, 10, 8, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath(); ctx.ellipse(al.x, al.y + 3 + wob * 0.4, 9, 4, 0, 0, 6.283); ctx.fill();
        ctx.strokeStyle = 'rgba(10,6,14,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(al.x - 6, al.y - 2 + wob * 0.4); ctx.lineTo(al.x + 6, al.y - 2 + wob * 0.4);
        ctx.moveTo(al.x - 5, al.y + 1 + wob * 0.4); ctx.lineTo(al.x + 5, al.y + 1 + wob * 0.4);
        ctx.stroke();
        // head with tracking eyes
        const hd = p.x > al.x ? 6 : -6;
        ctx.fillStyle = this.pal.alien;
        ctx.beginPath(); ctx.arc(al.x + hd, al.y - 4 + wob * 0.4, 5.5, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#120a18';
        ctx.beginPath(); ctx.arc(al.x + hd + 2, al.y - 5 + wob * 0.4, 1.6, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(al.x + hd - 2, al.y - 7 + wob * 0.4, 1.6, 0, 6.283); ctx.fill();
        if(al.spitter){
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.4 + 0.2 * Math.sin(al.t * 7);
          ctx.fillStyle = '#ff9d5c';
          ctx.beginPath(); ctx.arc(al.x - hd * 0.6, al.y + wob * 0.4, 4, 0, 6.283); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.restore();
          ctx.strokeStyle = '#ff9d5c'; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(al.x - 8, al.y - 8); ctx.lineTo(al.x - 12, al.y - 14);
          ctx.moveTo(al.x + 8, al.y - 8); ctx.lineTo(al.x + 12, al.y - 14);
          ctx.stroke();
        }
        // alien health bar (always visible)
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(al.x - 10, al.y - 18, 20, 3);
        ctx.fillStyle = '#ff5f7a';
        ctx.fillRect(al.x - 10, al.y - 18, 20 * Math.max(0, al.hp / (al.spitter ? 26 : 16)), 3);
      }

      // bullets with glowing trails
      for(const b of this.bullets){
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = b.friendly ? '#aef2ff' : '#c0ff5f';
        ctx.beginPath(); ctx.arc(b.x, b.y, 6.5, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
        ctx.fillStyle = b.friendly ? '#aef2ff' : '#c0ff5f';
        ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, 6.283); ctx.fill();
      }

      // player (detailed survivor: backpack, vest, visor, animated legs, muzzle flash)
      {
        const aim = p.aim;
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.beginPath(); ctx.ellipse(p.x + 4, p.y + 9, 9, 4, 0, 0, 6.283); ctx.fill();
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(aim);
        // legs (stride perpendicular to aim)
        const stride = this.moving ? Math.sin(this.walkT * 14) * 3 : 0;
        ctx.fillStyle = '#31456e';
        ctx.fillRect(-3, -6 + stride, 6, 4);
        ctx.fillRect(-3, 2 - stride, 6, 4);
        // backpack
        ctx.fillStyle = '#3a4a6e';
        ctx.fillRect(-11, -4.5, 5, 9);
        ctx.fillStyle = '#5ff0ff';
        ctx.globalAlpha = 0.7;
        ctx.fillRect(-10.5, -1.5, 2, 3);
        ctx.globalAlpha = 1;
        // torso + vest
        ctx.fillStyle = '#4a5a8a';
        ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 5.5, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#5d6fa8';
        ctx.beginPath(); ctx.ellipse(1, -1, 4.5, 3.5, 0, 0, 6.283); ctx.fill();
        // helmet + visor
        ctx.fillStyle = '#c9a35f';
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#31456e';
        ctx.beginPath(); ctx.arc(-2, 0, 7, Math.PI * 0.6, Math.PI * 1.4); ctx.fill();
        ctx.fillStyle = '#22334d';
        ctx.beginPath(); ctx.arc(3, 0, 4.5, -1.2, 1.2); ctx.fill();
        ctx.fillStyle = 'rgba(174,242,255,0.6)'; // visor glint
        ctx.beginPath(); ctx.arc(4, -1.5, 1.4, 0, 6.283); ctx.fill();
        // rifle
        ctx.fillStyle = '#2a3450';
        ctx.fillRect(3, -1.8, 15, 3.6);
        ctx.fillStyle = '#5ff0ff';
        ctx.fillRect(16, -1, 3, 2);
        // muzzle flash
        if(this.fireFlash > 0){
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = '#ffd479';
          ctx.globalAlpha = this.fireFlash / 0.08;
          ctx.beginPath(); ctx.arc(21, 0, 5, 0, 6.283); ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        if(this.harvest){
          const pct = Math.min(1, this.harvestT / 1.8);
          ctx.strokeStyle = '#5ff0ff'; ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y - 22, 9, -1.57, -1.57 + pct * 6.283);
          ctx.stroke();
        }
      }

      // fx particles: glowing sparks + physical chips
      for(const f of this.fx){
        const a = Math.max(0, f.life / f.maxLife);
        if(f.glow){
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a * 0.4;
          ctx.fillStyle = f.color;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 2.6, 0, 6.283); ctx.fill();
          ctx.globalAlpha = a;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
          ctx.restore();
        } else {
          ctx.globalAlpha = a;
          ctx.fillStyle = f.color;
          ctx.fillRect(f.x - f.r / 2, f.y - f.r / 2, f.r, f.r);
          ctx.globalAlpha = 1;
        }
      }

      ctx.restore();

      // hit flash vignette
      if(this.hitFlash > 0){
        ctx.fillStyle = 'rgba(255,60,80,' + (this.hitFlash * 0.4).toFixed(2) + ')';
        ctx.fillRect(0, 0, vw, vh);
      }
      // planetary HUD: equipped weapon + energy cells
      if(window.PD.equippedWeapon){
        const w = WEAPON_DEFS[window.PD.equippedWeapon];
        ctx.fillStyle = 'rgba(4,10,20,0.75)';
        ctx.fillRect(16, 16, 200, 44);
        ctx.strokeStyle = 'rgba(95,240,255,0.3)';
        ctx.strokeRect(16, 16, 200, 44);
        ctx.fillStyle = '#5ff0ff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'left';
        // weapon icon + name + damage + delay
        const icon = window.PD.equippedWeapon === 'laserpistol' ? '⚬|' : '⚬|=';
        ctx.fillText(icon + ' ' + w.name + '  DMG ' + w.dmg + '  DELAY ' + w.delay.toFixed(2) + 's', 26, 34);
        ctx.fillStyle = '#ffd479';
        ctx.fillText('PULSE ROUNDS ×' + window.PD.energyCells, 26, 52);
        // owned weapons
        let ox = 26;
        for(const wk of window.PD.weapons){
          const wd = WEAPON_DEFS[wk];
          const active = window.PD.equippedWeapon === wk;
          ctx.fillStyle = active ? '#5ff0ff' : '#8fc6d8';
          ctx.fillText((active ? '▶ ' : '  ') + wd.name, ox + 110, 34);
          ox += 100;
        }
        // switch hint when both owned
        if(window.PD.weapons.length >= 2){
          ctx.fillStyle = '#8fc6d8';
          ctx.font = '11px sans-serif';
          ctx.fillText('[G] SWITCH WEAPON', 26, 68);
        }
      }
      // atmosphere tint + vignette
      ctx.fillStyle = this.pal.tint;
      ctx.fillRect(0, 0, vw, vh);
      const vg = ctx.createRadialGradient(vw/2, vh/2, vh * 0.42, vw/2, vh/2, vh * 0.85);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, vw, vh);

      // seamless landing transition: descent glow fades out over ~0.9s
      if(this.enterFlash > 0){
        const e = this.enterFlash;
        const eg = ctx.createRadialGradient(vw/2, vh/2, vh * 0.1, vw/2, vh/2, vh * 0.75);
        eg.addColorStop(0, 'rgba(255,255,255,' + (e * 0.5).toFixed(3) + ')');
        eg.addColorStop(1, 'rgba(127,224,255,' + (e * 0.22).toFixed(3) + ')');
        ctx.fillStyle = eg;
        ctx.fillRect(0, 0, vw, vh);
      }

      // minimap (Mini DayZ style)
      const ms = 130, mx = vw - ms - 16, my = vh - ms - 16;
      ctx.fillStyle = 'rgba(4,10,20,0.75)';
      ctx.fillRect(mx, my, ms, ms);
      ctx.strokeStyle = 'rgba(95,240,255,0.3)';
      ctx.strokeRect(mx, my, ms, ms);
      const sc = ms / WORLD;
      ctx.fillStyle = '#ffd479';
      if(st.ship) ctx.fillRect(mx + st.ship.x * sc - 2, my + st.ship.y * sc - 2, 5, 5);
      if(st.trader){ ctx.fillStyle = '#6bff9e'; ctx.fillRect(mx + st.trader.x * sc - 2, my + st.trader.y * sc - 2, 4, 4); }
      ctx.fillStyle = '#ff5f7a';
      for(const al of this.aliens) ctx.fillRect(mx + al.x * sc - 1, my + al.y * sc - 1, 2.5, 2.5);
      ctx.fillStyle = '#5ff0ff';
      ctx.fillRect(mx + p.x * sc - 2.5, my + p.y * sc - 2.5, 5, 5);
      ctx.strokeStyle = 'rgba(95,240,255,0.35)';
      ctx.strokeRect(mx + (camX - vw/2) * sc, my + (camY - vh/2) * sc, vw * sc, vh * sc);
      ctx.fillStyle = 'rgba(95,240,255,0.7)';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('MAP · ' + this.planet.name, mx + 4, my + 12);
    }
  };

  window.Planet = PL;
})();
