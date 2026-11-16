(function(){
  'use strict';
  // 2D top-down planet mode: Mini DayZ-style survival, harvesting, aliens.
  const WORLD = 2400;

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
    hostile2: { base: '#5a4030', patch1: '#6a4c38', patch2: '#4a3426', sand: '#7d6a4d', water: '#5a3d30', tint: 'rgba(80,20,0,0.18)',     alien: '#ff9d5c' }
  };

  const PL = {
    active: false, ctx: null,
    state: null,   // per-landing world
    planet: null,
    player: { x: WORLD/2, y: WORLD/2 + 120, aim: 0 },
    fireT: 0, harvest: null, harvestT: 0,
    prompt: '', promptTarget: null,
    hitFlash: 0,

    init(ctx){ this.ctx = ctx; },

    enter(planetIdx){
      this.active = true;
      const PD = window.PD;
      this.planet = window.PLANETS[planetIdx];
      this.pal = PALETTES[planetIdx === 0 ? 'peaceful' : planetIdx === 1 ? 'mixed' : planetIdx === 2 ? 'hostile1' : 'hostile2'];
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
      this.aliens = [];
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
        speed: spitter ? 40 : 62 + this.planet.alienRate * 14,
        t: Math.random() * 6, atkT: 0, wob: Math.random() * 6.28
      });
    },

    isNearShip(){
      if(!this.state || !this.state.ship) return false;
      return Math.hypot(this.player.x - this.state.ship.x, this.player.y - this.state.ship.y) < 70;
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
      if(moving){
        if(this.harvest){ this.harvest = null; } // moving cancels harvesting
        const l = Math.hypot(dx, dy);
        const sp = 150;
        p.x = Math.max(60, Math.min(WORLD - 60, p.x + dx / l * sp * dt));
        p.y = Math.max(60, Math.min(WORLD - 60, p.y + dy / l * sp * dt));
      }

      // aim
      p.aim = Math.atan2(inp.mouseWorldY - p.y, inp.mouseWorldX - p.x);

      // shoot
      this.fireT -= dt;
      if((inp.mouseDown || inp.keys.has('Space')) && this.fireT <= 0){
        this.fireT = 0.28;
        this.bullets.push({
          x: p.x + Math.cos(p.aim) * 14, y: p.y + Math.sin(p.aim) * 14,
          vx: Math.cos(p.aim) * 420, vy: Math.sin(p.aim) * 420, life: 0.9, friendly: true
        });
        window.GameAudio.shoot2d();
      }

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
              al.hp -= 12;
              this.bullets.splice(i, 1);
              window.GameAudio.laserHit();
              if(al.hp <= 0){
                this.aliens.splice(a, 1);
                this.state.stats.kills++;
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

      // nests keep breeding on hostile worlds
      this.spawnT -= dt;
      if(this.spawnT <= 0){
        this.spawnT = 12;
        if(this.aliens.length < 14 && this.planet.alienRate > 0.5){
          const nest = this.state.nestsR[Math.floor(Math.random() * this.state.nestsR.length)];
          if(nest){
            this.aliens.push({
              x: nest.x + (Math.random() - 0.5) * 60, y: nest.y + (Math.random() - 0.5) * 60,
              hp: 16, spitter: false, speed: 62 + this.planet.alienRate * 14,
              t: 0, atkT: 0, wob: Math.random() * 6.28
            });
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
          }
          if(this.harvestT >= need){
            target.hp--;
            this.harvestT = 0;
            if(kind === 'crystal') this._give('crystal', 2);
            else if(kind === 'tree') this._give('wood', 2);
            else this._give('ore', 2);
            if(target.hp <= 0){
              if(kind === 'crystal') this._give('crystal', 1);
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

      if(this.hitFlash > 0) this.hitFlash -= dt;
      if(!PD.alive){ window.Game.onPlanetDeath(); return; }
    },

    _useMedkit(){
      if(window.PD.useMedkit()){
        window.GameAudio.uiBuy();
        window.Game.uiToast('MEDKIT USED +55');
      } else {
        window.GameAudio.uiClick();
      }
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
      PD.dmg(n);
      this.hitFlash = 0.5;
      window.GameAudio.hurt();
      this.hitShake = 8;
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

      // nests
      for(const n of st.nestsR){
        ctx.fillStyle = '#1c141f';
        ctx.beginPath(); ctx.ellipse(n.x, n.y, 26, 18, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#4a2a3a';
        for(let e = 0; e < 3; e++){
          ctx.beginPath(); ctx.ellipse(n.x - 8 + e * 8, n.y - 4 - (e % 2) * 4, 5, 7, 0, 0, 6.283); ctx.fill();
        }
      }

      // rocks (ore nodes)
      for(const r of st.rocks){
        if(r.x < ox - 40 || r.x > ox + vw + 40 || r.y < oy - 40 || r.y > oy + vh + 40) continue;
        ctx.fillStyle = '#5a5f6a';
        ctx.beginPath();
        ctx.moveTo(r.x + 18, r.y);
        ctx.lineTo(r.x + 6, r.y - 14); ctx.lineTo(r.x - 10, r.y - 10);
        ctx.lineTo(r.x - 16, r.y + 4); ctx.lineTo(r.x - 2, r.y + 14);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8fa0b5';
        ctx.fillRect(r.x - 4, r.y - 8, 5, 5);
        ctx.fillRect(r.x + 4, r.y - 2, 4, 4);
        if(r.hp <= 1){ ctx.fillStyle = '#3d4149'; ctx.fillRect(r.x - 16, r.y - 2, 32, 14); }
      }

      // trees
      for(const t of st.trees){
        if(t.x < ox - 50 || t.x > ox + vw + 50 || t.y < oy - 60 || t.y > oy + vh + 60) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(t.x, t.y + 8, 16, 6, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#5a4632';
        ctx.fillRect(t.x - 3, t.y - 12, 6, 20);
        if(t.hp <= 0){
          ctx.fillStyle = '#3a4a3a';
          ctx.beginPath(); ctx.ellipse(t.x, t.y - 18, 5, 4, 0, 0, 6.283); ctx.fill();
        } else {
          const g = t.hp === 3 ? 0 : 1;
          ctx.fillStyle = this.planet.type === 'hostile' ? '#3d5240' : '#2d5231';
          ctx.beginPath(); ctx.arc(t.x, t.y - 22, 15 - g * 2, 0, 6.283); ctx.fill();
          ctx.fillStyle = this.planet.type === 'hostile' ? '#4d6a50' : '#3d6b40';
          ctx.beginPath(); ctx.arc(t.x - 6 + g * 3, t.y - 26, 9 - g, 0, 6.283); ctx.fill();
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

      // trader
      if(st.trader){
        const t = st.trader;
        ctx.fillStyle = '#3a3040';
        ctx.fillRect(t.x - 16, t.y - 6, 32, 20);
        ctx.fillStyle = '#8a6a3a';
        ctx.fillRect(t.x - 16, t.y - 10, 32, 5);
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
        ctx.beginPath(); ctx.ellipse(0, 6, 26, 10, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#c9d4e0';
        ctx.beginPath();
        ctx.moveTo(0, -22); ctx.lineTo(12, 8); ctx.lineTo(0, 16); ctx.lineTo(-12, 8);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#3d5a80';
        ctx.fillRect(-20, 2, 40, 6);
        ctx.fillStyle = '#5ff0ff';
        ctx.beginPath(); ctx.arc(0, -6, 3.4, 0, 6.283); ctx.fill();
        if(this.isNearShip()){
          ctx.strokeStyle = 'rgba(95,240,255,0.5)';
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.arc(0, 0, 70, 0, 6.283); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      // aliens
      for(const al of this.aliens){
        if(al.x < ox - 40 || al.x > ox + vw + 40 || al.y < oy - 40 || al.y > oy + vh + 40) continue;
        const wob = Math.sin(al.t * 9 + al.wob) * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(al.x, al.y + 9, 10, 4, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = this.pal.alien;
        ctx.beginPath(); ctx.ellipse(al.x, al.y + wob * 0.4, 10, 8, 0, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(al.x + (p.x > al.x ? 6 : -6), al.y - 4 + wob * 0.4, 5.5, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#120a18';
        ctx.beginPath(); ctx.arc(al.x + (p.x > al.x ? 8 : -8), al.y - 5 + wob * 0.4, 1.6, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(al.x + (p.x > al.x ? 4 : -4), al.y - 7 + wob * 0.4, 1.6, 0, 6.283); ctx.fill();
        if(al.spitter){
          ctx.strokeStyle = '#ff9d5c'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(al.x - 8, al.y - 8); ctx.lineTo(al.x - 12, al.y - 14);
          ctx.moveTo(al.x + 8, al.y - 8); ctx.lineTo(al.x + 12, al.y - 14);
          ctx.stroke();
        }
        if(al.hp < (al.spitter ? 26 : 16)){
          ctx.fillStyle = '#ff5f7a';
          ctx.fillRect(al.x - 10, al.y - 18, 20 * Math.max(0, al.hp / (al.spitter ? 26 : 16)), 3);
        }
      }

      // bullets
      for(const b of this.bullets){
        ctx.fillStyle = b.friendly ? '#aef2ff' : '#c0ff5f';
        ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, 6.283); ctx.fill();
      }

      // player (survivor)
      {
        const aim = p.aim;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 8, 9, 4, 0, 0, 6.283); ctx.fill();
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(aim);
        ctx.fillStyle = '#4a5a8a';
        ctx.fillRect(2, -3, 16, 6);
        ctx.fillStyle = '#c9a35f';
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#31456e';
        ctx.beginPath(); ctx.arc(-2, 0, 7, Math.PI * 0.6, Math.PI * 1.4); ctx.fill();
        ctx.restore();
        if(this.harvest){
          const pct = Math.min(1, this.harvestT / 1.8);
          ctx.strokeStyle = '#5ff0ff'; ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y - 22, 9, -1.57, -1.57 + pct * 6.283);
          ctx.stroke();
        }
      }

      ctx.restore();

      // hit flash vignette
      if(this.hitFlash > 0){
        ctx.fillStyle = 'rgba(255,60,80,' + (this.hitFlash * 0.4).toFixed(2) + ')';
        ctx.fillRect(0, 0, vw, vh);
      }
      // atmosphere tint + vignette
      ctx.fillStyle = this.pal.tint;
      ctx.fillRect(0, 0, vw, vh);
      const vg = ctx.createRadialGradient(vw/2, vh/2, vh * 0.42, vw/2, vh/2, vh * 0.85);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, vw, vh);

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
