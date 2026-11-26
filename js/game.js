(function(){
  'use strict';
  // Main controller: state machine, input, HUD, menus, transitions.
  const G = {
    state: 'start', // start | space | planet | dead
    input: null,
    hudCtx: null, fade: null, els: {},
    toastTimer: 0, menuOpen: false,

    init(){
      this.els = {
        space: document.getElementById('space3d'),
        hud: document.getElementById('hud2d'),
        hudDom: document.getElementById('hud'),
        cross: document.getElementById('crosshair'),
        prompt: document.getElementById('hud-prompt'),
        toasts: document.getElementById('toasts'),
        menu: document.getElementById('menu'),
        menuInner: document.getElementById('menu-inner'),
        fade: document.getElementById('fade'),
        start: document.getElementById('screen-start'),
        gameover: document.getElementById('screen-gameover')
      };
      this.hudCtx = this.els.hud.getContext('2d');
      this.fade = this.els.fade;
      this._bindInput();
      window.Space.init(this.els.space);
      window.Planet.init(this.hudCtx);
      const self = this;
      // Start screen: Continue or New Game
      const btnContinue = document.getElementById('btn-continue');
      const btnNew = document.getElementById('btn-new');
      const startGame = (fresh) => {
        if(fresh){
          window.PD.newGame();
          window.PD.save();
        }
        window.GameAudio.init(); window.GameAudio.resume(); window.GameAudio.warp();
        self.els.start.classList.add('hidden');
        self._toSpace(true);
        // ensure only the current system's bodies exist in the active world
        window.Space.syncWorld();
      };
      if(btnContinue){
        btnContinue.disabled = !window.PD.hasSave();
        btnContinue.addEventListener('click', () => startGame(false));
      }
      if(btnNew){
        btnNew.addEventListener('click', () => startGame(true));
      }
      window.addEventListener('resize', () => this._resize());
      this._resize();
      // boot loop
      let last = performance.now();
      const frame = now => {
        try {
          const dt = Math.min(1/30, (now - last) / 1000);
          last = now;
          this.update(dt);
          this.render();
        } catch(e){
          const el = document.getElementById('error-log');
          if(el){ el.style.display = 'block'; el.innerText = 'CRITICAL:\n' + (e.stack || e.message); }
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },

    _resize(){
      const w = window.innerWidth, h = window.innerHeight;
      const hud = this.els.hud;
      hud.width = w; hud.height = h;
      if(window.Space.ready) window.Space._resize();
    },

    _bindInput(){
      const inp = {
        keys: new Set(),
        pressedCodes: new Set(),
        mouseDown: false,
        mouseWorldX: 0, mouseWorldY: 0,
        pressed(code){ return this.pressedCodes.has(code); }
      };
      this.input = inp;
      window.addEventListener('keydown', e => {
        const c = e.code;
        if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','KeyE','KeyR','KeyH','KeyQ','KeyG','Tab','KeyB','KeyN','KeyM','KeyF'].indexOf(c) >= 0) e.preventDefault();
        window.GameAudio.init(); window.GameAudio.resume();
        if(!inp.keys.has(c)) inp.pressedCodes.add(c);
        inp.keys.add(c);
        if(c === 'KeyM'){ const m = window.GameAudio.toggleMute(); this.uiToast(m ? 'SOUND OFF' : 'SOUND ON'); }
      });
      window.addEventListener('keyup', e => inp.keys.delete(e.code));
      window.addEventListener('blur', () => inp.keys.clear());
      window.addEventListener('mousemove', e => {
        // pointer position is tracked only for planetary auto-aim (screen coords);
        // it never feeds ship steering — spaceflight orientation is keyboard-only.
        inp.mouseWorldX = e.clientX;
        inp.mouseWorldY = e.clientY;
      });
      window.addEventListener('mousedown', e => { inp.mouseDown = true; });
      window.addEventListener('mouseup', e => { inp.mouseDown = false; });
      window.addEventListener('contextmenu', e => e.preventDefault());
    },

    // ---------- transitions ----------
    _fade(cb){
      this.fade.classList.add('on');
      setTimeout(() => {
        cb();
        setTimeout(() => this.fade.classList.remove('on'), 120);
      }, 480);
    },

    _toSpace(fresh){
      this.state = 'space';
      this.els.space.classList.remove('hidden');
      this.els.hud.classList.remove('hidden');
      this.menuClose();
      window.Planet.exit();
      window.Space.enter();
      this.els.hudDom.classList.remove('hidden');
      this.els.cross.classList.remove('hidden');
      this.els.hud.style.pointerEvents = 'none';
      // ensure only the current system's bodies exist in the active world
      window.Space.syncWorld();
      // spawn mission-specific encounters for the current system
      if(window.Space._spawnMissionEncounters) window.Space._spawnMissionEncounters();
    },

    landOn(planetIdx){
      if(this.state !== 'space') return;
      const planet = window.PLANETS[planetIdx];
      if(planet){
        window.PD.systemIdx = planet.sys;
        window.PD.save();
      }
      window.GameAudio.land();
      window.Space.saveForLanding();
      this._fade(() => {
        this.state = 'planet';
        window.Space.exit();
        // hide the WebGL canvas entirely so no stale 3D frame can show through
        this.els.space.classList.add('hidden');
        this.els.hud.classList.remove('hidden');
        this.els.cross.classList.add('hidden');
        window.Planet.enter(planetIdx);
        this.els.hud.style.pointerEvents = 'none';
      });
    },

    takeOff(){
      if(this.state !== 'planet') return;
      if(window.PD.crashRecovery && window.PD.crashRecovery.active){
        this.uiToast('SHIP DAMAGED — repair the wreck before takeoff');
        return;
      }
      window.GameAudio.takeoff();
      this._fade(() => {
        this._toSpace();
        window.GameAudio.warp();
        this.uiToast('IN ORBIT — ' + window.PLANETS[window.PD.planetIndex].name);
      });
    },

    onSpaceDeath(){
      if(this.deathHandled) return;
      this.deathHandled = true;
      window.GameAudio.bigBoom();
      this._fade(() => {
        const PD = window.PD;
        // Emergency crash landing: find nearest landable planet in the current system.
        const sys = PD.systemIdx | 0;
        const candidates = window.PLANETS.map((p, i) => ({ p, i }))
          .filter(({ p }) => ((p.sys | 0) === sys));
        let best = null, bd = Infinity;
        const shipPos = window.Space.ship.position;
        for(const { p, i } of candidates){
          const d = Math.hypot(p.x - shipPos.x, p.y - shipPos.y, p.z - shipPos.z);
          if(d < bd){ bd = d; best = i; }
        }
        if(best != null){
          // crash recovery state
          PD.crashRecovery = {
            active: true,
            systemIdx: sys,
            planetIdx: best,
            progress: 0,
            components: { hull_plate: 2, power_cell: 2 },
            have: { hull_plate: 0, power_cell: 0 },
            playerWreck: null,
            salvageWreck: null,
          };
          // clear previous surface state for a fresh scenario
          if(PD.surfaceStates) delete PD.surfaceStates[best];
          // player health ~50% of max, valid living state
          PD.playerHp = Math.max(1, Math.round(PD.playerHpMax() * 0.5));
          PD.alive = true;
          window.Space.saveForLanding();
          PD.planetIndex = best;
          PD.save();
          this.state = 'planet';
          window.Space.exit();
          this.els.space.classList.add('hidden');
          this.els.hud.classList.remove('hidden');
          this.els.cross.classList.add('hidden');
          window.Planet.enter(best);
          this.els.hud.style.pointerEvents = 'none';
          this.deathHandled = false;
          this.uiToast('CRASH LANDING on ' + window.PLANETS[best].name + ' — recover and repair your ship');
        } else {
          // fallback to ordinary respawn
          for(const k in window.PD.cargo) window.PD.cargo[k] = Math.floor(window.PD.cargo[k] * 0.75);
          window.PD.credits = Math.floor(window.PD.credits * 0.9);
          window.PD.save();
          window.Space.respawn();
          this.deathHandled = false;
          this.uiToast('SHIP REBUILT AT ORION STATION — cargo losses incurred');
        }
      });
    },

    onPlanetDeath(){
      if(this.deathHandled) return;
      this.deathHandled = true;
      window.GameAudio.bigBoom();
      this._fade(() => {
        const PD = window.PD;
        // Do NOT respawn on planet. Trigger Game Over.
        // Save current state as checkpoint (preserving all progress)
        PD.save();
        // Show Game Over screen
        this.state = 'gameover';
        this.els.gameover.classList.remove('hidden');
        this.els.hud.classList.add('hidden');
        this.els.cross.classList.add('hidden');
        this.els.space.classList.add('hidden');
        // Wire up buttons
        const btnContinue = document.getElementById('btn-gameover-continue');
        const btnNew = document.getElementById('btn-gameover-new');
        if(btnContinue){
          btnContinue.disabled = !PD.hasSave();
          btnContinue.onclick = () => {
            PD.load();
            this.els.gameover.classList.add('hidden');
            this._toSpace(false);
            window.Space.syncWorld();
            this.deathHandled = false;
          };
        }
        if(btnNew){
          btnNew.onclick = () => {
            PD.newGame();
            PD.save();
            this.els.gameover.classList.add('hidden');
            this._toSpace(true);
            window.Space.syncWorld();
            this.deathHandled = false;
          };
        }
        this.deathHandled = false;
      });
    },

    // ---------- menus ----------
    menuOpenNow: false,
    menuTab: 'equipment', // station tabs: equipment | market | missions
    galaxyOpen: false,
    stationIdx: 0,
    visitN: 0,
    _pendingJump: null, // { system: idx } awaiting hyperspace confirmation (Stage C)
    _pendingRepair: null, // { cost } awaiting repair confirmation (Step 2)
    openStation(stationIdx){
      if(this.menuOpenNow) return;
      this.menuOpenNow = true;
      this.galaxyOpen = false;
      this.stationIdx = stationIdx !== undefined ? stationIdx : Math.max(0, window.Space.nearStationIdx);
      const station = window.STATIONS[this.stationIdx];
      if(station){
        window.PD.systemIdx = station.sys;
        window.PD.save();
      }
      // dock: stop engine audio and hide the exterior space scene
      this._stationDocked = true;
      if(window.Space) window.Space.exit();
      if(this.els && this.els.space) this.els.space.classList.add('hidden');
      // load this system's mission board (generate lazily on render)
      this._npcs = (window.PD.missionBoards && window.PD.missionBoards[window.PD.systemIdx]) || null;
      // procedural economy: prices reshuffle every visit (all markets)
      window.PD.rollMarkets();
      this.visitN++;
      this.menuTab = 'equipment';
      window.GameAudio.uiClick();
      this._renderStation();
      this.els.menu.classList.remove('hidden');
      this.els.menu.classList.add('open');
    },
    openTrade(){
      if(this.menuOpenNow) return;
      // short cooldown so the same E press that closed the menu can't instantly reopen it
      if((this._closeCd || 0) > 0) return;
      this.menuOpenNow = true;
      this.galaxyOpen = false;
      window.PD.rollMarkets();
      this.visitN++;
      window.GameAudio.uiClick();
      this._renderTrade();
      this.els.menu.classList.remove('hidden');
      this.els.menu.classList.add('open');
    },
    openGalaxy(){
      if(this.menuOpenNow) return;
      this.menuOpenNow = true;
      this.galaxyOpen = true;
      window.GameAudio.uiClick();
      this._renderGalaxy();
      this.els.menu.classList.remove('hidden');
      this.els.menu.classList.add('open');
    },
    menuClose(){
      this.menuOpenNow = false;
      this.galaxyOpen = false;
      this._closeCd = 6; // ~0.1s: block instant E-reopen at interactables
      this.els.menu.classList.add('hidden');
      this.els.menu.classList.remove('open'); // Step 3E: menu open -> cursor visible over game viewport
       if(this._stationDocked){
         this._stationDocked = false;
         if(this.els && this.els.space) this.els.space.classList.remove('hidden');
         if(window.Space) window.Space.active = true;
       }
    },

    _lvl(l){ return '▮'.repeat(l) + '▯'.repeat(5 - l); },
    _row(right, title, sub, price, btnTxt, cb, disabled){
      const row = document.createElement('div');
      row.className = 'menu-row';
      row.innerHTML =
        '<div class="name">' + title + (sub ? '<small>' + sub + '</small>' : '') + '</div>' +
        '<div class="price">' + price + '</div>';
      const b = document.createElement('button');
      b.className = 'menu-btn';
      b.textContent = btnTxt;
      b.disabled = !!disabled;
      b.addEventListener('click', cb);
      row.appendChild(b);
      right.appendChild(row);
      return row;
    },
    _tabs(m, tabs, active, cb){
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-bottom:12px';
      for(const t of tabs){
        const b = document.createElement('button');
        b.className = 'menu-btn';
        b.textContent = t.label;
        if(t.id === active) b.style.background = 'rgba(95,240,255,.35)';
        b.addEventListener('click', () => cb(t.id));
        bar.appendChild(b);
      }
      m.appendChild(bar);
    },

    // price landscape line: every market's unit price for a good
    _priceLine(good){
      const parts = [];
      for(const mk in window.TRADE_MARKETS){
        const reachable = mk !== 'p2' && mk !== 'p3' && mk !== 'p5';
        parts.push(window.MARKET_NAMES[mk] + ' ' +
          (reachable ? window.PD.tradeBuyPrice(good, mk) : '—'));
      }
      return parts.join(' · ');
    },
    // Market stock for planetary weapons/ammo: persists between openings,
    // refreshed periodically. Stations always stock energy cells; traders
    // have a lower probability of stocking weapons and ammo.
    _marketStock(marketKey){
      const PD = window.PD;
      if(!PD.marketStock[marketKey]){
        const isStation = marketKey === 'station';
        const stock = { energyCells: 0, missiles: 0, weapons: {} };
        stock.energyCells = isStation
          ? (5 + Math.floor(Math.random() * 10))
          : (Math.random() < 0.5 ? (3 + Math.floor(Math.random() * 6)) : 0);
        stock.missiles = isStation
          ? (3 + Math.floor(Math.random() * 6))
          : (Math.random() < 0.4 ? (1 + Math.floor(Math.random() * 4)) : 0);
        for(const wk in window.WEAPON_DEFS){
          if(!PD.hasWeapon(wk) && (isStation || Math.random() < 0.3)){
            stock.weapons[wk] = 1;
          }
        }
        PD.marketStock[marketKey] = stock;
      }
      return PD.marketStock[marketKey];
    },

    _renderStation(){
      const PD = window.PD;
      const m = this.els.menuInner;
      const stName = window.Space.stations[this.stationIdx] ? window.Space.stations[this.stationIdx].def.name : 'ORION STATION';
      m.innerHTML = '<h2>' + stName + '</h2><div class="sub">◈ ' + PD.credits + ' CR · cargo ' +
        PD.cargoUsed() + '/' + PD.cargoMax() + ' · missions ' + PD.missions.length + '/3</div>';
      this._tabs(m, [{ id: 'equipment', label: 'EQUIPMENT' }, { id: 'market', label: 'MARKET' },
        { id: 'missions', label: 'MISSIONS' }],
        this.menuTab, id => { this.menuTab = id; window.GameAudio.uiClick(); this._renderStation(); });

      if(this.menuTab === 'market'){
        this._renderMarket(m);
      } else if(this.menuTab === 'missions'){
        this._renderMissions(m);
      } else {
        this._renderEquipment(m);
      }
      const close = document.createElement('button');
      close.className = 'menu-btn menu-close';
      close.textContent = 'UNDOCK  [E]';
      close.addEventListener('click', () => this.menuClose());
      m.appendChild(close);
    },

    // ---------- missions: procedural NPC board + completion engine ----------
    _mDestBodies(excludeStationIdx){
      const list = [];
      for(let i = 0; i < window.STATIONS.length; i++){
        if(i === excludeStationIdx) continue;
        list.push({ kind: 'station', idx: i, name: window.STATIONS[i].name });
      }
      for(const i of [0, 1, 4]){ // market-bearing outposts
        list.push({ kind: 'planet', idx: i, name: window.PLANETS[i].name });
      }
      return list;
    },

    _genNpcs(){
      const PD = window.PD;
      const firsts = ['Ryn', 'Kova', 'Dax', 'Mira', 'Olek', 'Sela', 'Brann', 'Talia', 'Juno', 'Corr'];
      const roles = ['freight hauler', 'prospector', 'colonist elder', 'bounty hunter', 'smuggler', 'waste-scrapper'];
      // seeded per-visit so the board is different every time but stable while open
      const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
      const types = ['delivery', 'hunt'];
      if(PD.hasModule('emp')) types.push('emp');
      if(PD.hasModule('passenger')) types.push('passenger');
      if(PD.hasModule('hyperdrive')) types.push('defence');
      const dests = this._mDestBodies(this.stationIdx);
      this._npcs = [];
      const pick = arr => arr[Math.floor(Math.random() * arr.length)];
      const rollMission = (type, i) => {
        const dest = pick(dests);
        let m;
        if(type === 'delivery'){
          const good = pick(Object.keys(window.TRADE_GOODS));
          const qty = rnd(4, 8);
          const est = PD.tradeBuyPrice(good, 'station') * qty;
          m = { type, good, qty, dest,
            label: 'Deliver ' + qty + ' ' + window.TRADE_GOODS[good].name + ' → ' + dest.name,
            desc: '"Haul ' + qty + ' ' + window.TRADE_GOODS[good].name.toLowerCase() + ' to ' + dest.name +
              '. Buy them here or bring your own."',
            reward: Math.round((est * 0.6 + 80) / 5) * 5 };
        } else if(type === 'passenger'){
          m = { type, dest,
            label: 'Ferry a passenger → ' + dest.name,
            desc: '"Get me (and my cargo of grievances) to ' + dest.name + ' in one piece, pilot."',
            reward: 250 + rnd(0, 8) * 25,
            // ambush data: will be populated when mission is accepted and system entered
            ambushPirate: null,
            ambushGenerated: false,
            ambushCompleted: false,
            destSystem: dest ? (dest.kind === 'station' ? window.STATIONS[dest.idx].sys : window.PLANETS[dest.idx].sys) : null
          };
        } else if(type === 'defence'){
          const need = rnd(3, 5);
          // Pick a destination in a different system
          const curSys = PD.systemIdx | 0;
          const otherDests = dests.filter(d => {
            const body = d.kind === 'station' ? window.STATIONS[d.idx] : window.PLANETS[d.idx];
            return body && (body.sys | 0) !== curSys;
          });
          const dest = otherDests.length ? pick(otherDests) : pick(dests);
          m = { type, need, have: 0, dest,
            label: 'System Defence — destroy ' + need + ' pirate ships in ' + dest.name.split(' ')[0],
            desc: 'Travel to ' + dest.name + ' and eliminate ' + need + ' Void Raiders threatening the system. (Requires Hyperdrive)',
            reward: need * 140,
            // defence data
            pirates: [],       // will hold mission-specific pirate references
            piratesGenerated: false,
            destSystem: dest ? (dest.kind === 'station' ? window.STATIONS[dest.idx].sys : window.PLANETS[dest.idx].sys) : null
          };
        } else if(type === 'hunt'){
          const need = rnd(2, 4);
          m = { type, need, have: 0, dest: null,
            label: 'Bounty: destroy ' + need + ' Void Raiders',
            desc: '"Raiders are bleeding our shipping lanes. Kill ' + need + ' of them and the guild pays."',
            reward: need * 90 };
        } else {
          const need = rnd(2, 3);
          m = { type: 'emp', need, have: 0, dest: null,
            label: 'Disable ' + need + ' raiders non-lethally',
            desc: '"The patrol union wants them stopped, not scrapped. Use your EMP emitter — no kills."',
            reward: need * 140 };
        }
        m.id = type + '-' + this.visitN + '-' + i;
        return m;
      };
      const nameOf = () => pick(firsts) + ' ' + String.fromCharCode(65 + Math.floor(Math.random() * 26)) + '.';
      const roleOf = () => pick(roles);
      const acceptedIds = new Set((PD.missions || []).map(m => m.id));
      let t0 = 'delivery';
      let t1 = pick(types), t2 = pick(types);
      let t3 = pick(types), t4 = pick(types), t5 = pick(types);
      // avoid offering missions already accepted by the player
      let tries = 0;
      while(acceptedIds.has(t0 + '-' + this.visitN + '-0') && tries++ < 5) t0 = pick(types);
      tries = 0;
      while(acceptedIds.has(t1 + '-' + this.visitN + '-1') && tries++ < 5) t1 = pick(types);
      tries = 0;
      while(acceptedIds.has(t2 + '-' + this.visitN + '-2') && tries++ < 5) t2 = pick(types);
      tries = 0;
      while(acceptedIds.has(t3 + '-' + this.visitN + '-3') && tries++ < 5) t3 = pick(types);
      tries = 0;
      while(acceptedIds.has(t4 + '-' + this.visitN + '-4') && tries++ < 5) t4 = pick(types);
      tries = 0;
      while(acceptedIds.has(t5 + '-' + this.visitN + '-5') && tries++ < 5) t5 = pick(types);
      const slots = [[t0], [t1], [t2], [t3], [t4], [t5]];
      for(let i = 0; i < 6; i++){
        const name = nameOf(), role = roleOf();
        let m = rollMission(slots[i][0], i);
        let r = 0;
        while(acceptedIds.has(m.id) && r++ < 5){
          m = rollMission(pick(types), i);
        }
        m.npc = name + ' (' + role + ')';
        this._npcs.push({ name: name + ' · ' + role, mission: m, dealt: false });
      }
      // persist board per system
      if(!PD.missionBoards) PD.missionBoards = {};
      PD.missionBoards[PD.systemIdx | 0] = this._npcs;
      PD.save();
    },

    _renderMissions(m){
      const PD = window.PD;
      if(!this._npcs) this._genNpcs();
      const nh = document.createElement('div');
      nh.innerHTML = '<div class="bar-label" style="margin-bottom:6px">STATION LOUNGE — NPCs HIRING <span>' +
        PD.missions.length + '/3 contracts</span></div>';
      m.appendChild(nh);
      for(const npc of this._npcs){
        const mi = npc.mission;
        const reqMod = (mi.type === 'passenger' && !PD.hasModule('passenger')) ||
          (mi.type === 'emp' && !PD.hasModule('emp'));
        this._row(m, npc.name, mi.label + ' — ' + mi.reward + ' CR', '', npc.dealt ? 'DEAL MADE' : 'ACCEPT', () => {
          if(npc.dealt) return;
          if(reqMod){ window.Game.uiToast('✖ REQUIRES A SHIP MODULE — see EQUIPMENT tab'); window.GameAudio.alarm(); return; }
          if(PD.missions.length >= 3){ window.Game.uiToast('✖ CONTRACT LOG FULL (3 max)'); return; }
          PD.missions.push(Object.assign({}, mi));
          npc.dealt = true;
          window.GameAudio.uiBuy();
          window.Game.uiToast('✒ CONTRACT SIGNED — ' + mi.label);
          PD.save();
          this._renderStation();
        }, npc.dealt || reqMod || PD.missions.length >= 3);
      }
      if(PD.missions.some(x => (x.type === 'passenger' && !PD.hasModule('passenger')) ||
          (x.type === 'emp' && !PD.hasModule('emp')))){
        const warn = document.createElement('div');
        warn.style.cssText = 'color:#ffb84d;font-size:11px;text-align:center';
        warn.textContent = '⚠ A contract needs its module installed — fit it in the EQUIPMENT tab.';
        m.appendChild(warn);
      }
      const ah = document.createElement('div');
      ah.innerHTML = '<div class="bar-label" style="margin:12px 0 6px">ACTIVE CONTRACTS</div>';
      m.appendChild(ah);
      if(!PD.missions.length){
        const d = document.createElement('div');
        d.style.cssText = 'color:#8fc6d8;font-size:12px;text-align:center';
        d.textContent = 'No active contracts — accept one from the lounge above.';
        m.appendChild(d);
      }
      for(let i = 0; i < PD.missions.length; i++){
        const mi = PD.missions[i];
        const prog = mi.type === 'delivery'
          ? 'carrying ' + Math.min(PD.trade[mi.good] | 0, mi.qty) + '/' + mi.qty + ' ' + window.TRADE_GOODS[mi.good].name
          : mi.type === 'passenger' ? 'ferry to ' + mi.dest.name
          : (mi.have | 0) + '/' + mi.need;
        // Add ambush/system defence progress display
        let extra = '';
        if(mi.type === 'passenger' && mi.ambushGenerated){
          extra = mi.ambushCompleted ? ' — Ambush cleared' : ' — Ambush active';
        } else if(mi.type === 'defence' && mi.piratesGenerated){
          const alive = (window.Space && window.Space.pirates) ? window.Space.pirates.filter(p => p && p.missionId === mi.id).length : 0;
          extra = ' — ' + (mi.have || 0) + '/' + (mi.need || 0) + ' destroyed';
        }
        this._row(m, mi.label, 'reward ' + mi.reward + ' CR · ' + prog + extra, '', 'ABANDON', () => {
          PD.missions.splice(i, 1);
          window.GameAudio.uiClick();
          PD.save();
          this._renderStation();
        });
      }
    },

    // mission progress / completion (runs every frame in space & on the surface)
    _checkMissions(){
      const PD = window.PD;
      const S = window.Space;
      if(!PD.missions.length) return;
      if(!S) return;
      for(let i = PD.missions.length - 1; i >= 0; i--){
        const mi = PD.missions[i];
        if(mi.type === 'defence'){
          // System Defence: complete exactly once when the assigned kill counter
          // reaches the requested group size. Only mission-assigned pirates increment it.
          if((mi.have || 0) >= (mi.need || 0)){
            PD.credits += mi.reward;
            this._missionDone(mi);
          }
          continue;
        }
        if(!mi.dest) continue; // kill/disable missions complete via events
        if(this._nearBody(mi.dest)){
          if(mi.type === 'delivery'){
            if((PD.trade[mi.good] | 0) >= mi.qty){
              // Passenger Transport: check ambush objective first
              if(mi.ambushGenerated && !mi.ambushCompleted){
                // ambush not yet completed - cannot deliver passenger yet
                // but we still award reward and complete if pirate already dead
                if(mi.ambushPirate && !S.pirates.includes(mi.ambushPirate)){
                  mi.ambushCompleted = true;
                  PD.credits += mi.reward;
                  this._missionDone(mi);
                }
              } else if(!mi.ambushGenerated || mi.ambushCompleted){
                // ambush either not generated or already completed - award reward
                PD.trade[mi.good] -= mi.qty;
                PD.credits += mi.reward;
                this._missionDone(mi);
              }
            }
          } else if(mi.type === 'passenger'){
            // Passenger Transport: award reward (ambush state handled above)
            // But only if ambush is completed or not generated
            if(!mi.ambushGenerated || mi.ambushCompleted){
              PD.credits += mi.reward;
              this._missionDone(mi);
            }
          }
        }
      }
    },
    _nearBody(dest){
      const S = window.Space;
      if(this.state === 'planet'){
        return dest.kind === 'planet' && dest.idx === window.PD.planetIndex;
      }
      if(this.state !== 'space') return false;
      let pos;
      if(dest.kind === 'station') pos = S.stations[dest.idx] && S.stations[dest.idx].grp.position;
      else pos = S.planetMeshes[dest.idx] && S.planetMeshes[dest.idx].position;
      return pos && S.ship.position.distanceTo(pos) < 200;
    },
    _missionDone(mi){
      const PD = window.PD;
      PD.missions.splice(PD.missions.indexOf(mi), 1);
      PD.missionsDone++;
      window.GameAudio.coin();
      this.uiToast('✔ CONTRACT COMPLETE — +' + mi.reward + ' CR (' + mi.label + ')');
      PD.save();
      // Clean up mission-specific data
      if(mi.type === 'passenger'){
        // ambush state is now complete, no further action needed
      } else if(mi.type === 'defence'){
        // pirates array can be cleared
        mi.pirates = [];
      }
    },
    onPirateKill(){
      for(const mi of window.PD.missions){
        if(mi.type === 'hunt'){
          mi.have = (mi.have | 0) + 1;
          if(mi.have >= mi.need){ window.PD.credits += mi.reward; this._missionDone(mi); }
          else window.Game.uiToast('CONTRACT ' + mi.label + ' — ' + mi.have + '/' + mi.need);
        }
      }
    },
    onPirateDisable(){
      for(const mi of window.PD.missions){
        if(mi.type === 'emp'){
          mi.have = (mi.have | 0) + 1;
          if(mi.have >= mi.need){ window.PD.credits += mi.reward; this._missionDone(mi); }
          else window.Game.uiToast('CONTRACT ' + mi.label + ' — ' + mi.have + '/' + mi.need);
        }
      }
    },

    // ---------- galaxy map (Tab): direct travel to any system body ----------
    // Derived from SYSTEMS (see js/player.js); never a second hand-maintained
    // copy. Keeping it a getter means the map always reflects the authoritative
    // system table.
    get GALAXY(){ return window.buildGalaxy(); },
    _bodyInfo(b){
      if(b.kind === 'station'){
        const st = window.STATIONS[b.idx];
        return { name: st.name, sub: window.PD.systemName(st.sys), color: '#ffd25f', pos: st.pos };
      }
      const p = window.PLANETS[b.idx];
      return { name: p.name, sub: p.type.toUpperCase() + ' · ' + p.desc,
        color: '#' + p.color.toString(16).padStart(6, '0'), pos: [p.x, p.y, p.z] };
    },
    _renderGalaxy(){
      const PD = window.PD;
      const m = this.els.menuInner;
      const curSys = PD.systemIdx | 0;
      const curName = PD.systemName(curSys);
      const bodyCount = window.SYSTEMS.reduce((n, s) => n + 1 + (s.planets ? s.planets.length : 0), 0);
      m.innerHTML = '<h2>GALAXY MAP</h2><div class="sub">◈ ' + PD.credits +
        ' CR · ' + window.SYSTEMS.length + ' systems · ' + bodyCount + ' bodies · [TAB] to close</div>' +
        '<div class="bar-label" style="margin:4px 0 8px;color:#5ff0ff">CURRENT SYSTEM · ' +
        curName + '</div>';
      const S = window.Space;
      const hasHD = PD.hasModule('hyperdrive');

      // Controls reference is reachable from the TAB menu.
      const ctrlRow = document.createElement('div');
      ctrlRow.className = 'menu-row';
      ctrlRow.innerHTML = '<div class="name">CONTROLS<small>all keyboard bindings, grouped by activity</small></div>' +
        '<div class="price">KEYBOARD</div>';
      const ctrlBtn = document.createElement('button');
      ctrlBtn.className = 'menu-btn';
      ctrlBtn.textContent = 'CONTROLS';
      ctrlBtn.addEventListener('click', () => { window.GameAudio.uiClick(); this._renderControls(); });
      ctrlRow.appendChild(ctrlBtn);
      m.appendChild(ctrlRow);

      // ---------- CURRENT SYSTEM: local destinations ----------
      const curHead = document.createElement('div');
      curHead.innerHTML = '<div class="bar-label" style="margin:10px 0 6px;color:#5ff0ff">' + curName + ' ◀ CURRENT</div>';
      m.appendChild(curHead);
      const curGal = this.GALAXY[curSys];
      if(curGal){
        // Combat-aware proximity: TAB Dock/Land uses the same eligibility as E.
        // Without pirates, travel works from any distance. With pirates present,
        // only bodies within E interaction range can be docked/landed on.
        const piratesPresent = S.pirates && S.pirates.length > 0;
        for(const b of curGal.bodies){
          const info = this._bodyInfo(b);
          const dist = Math.round(Math.hypot(
            info.pos[0] - S.ship.position.x, info.pos[1] - S.ship.position.y, info.pos[2] - S.ship.position.z));
          // Proximity eligibility matches the E interaction range exactly:
          // station: dist < 160 (space3d.js proximity), planet: dist < size + 70.
          let withinReach = false;
          if(b.kind === 'station'){
            withinReach = dist < 160;
          } else {
            const p = window.PLANETS[b.idx];
            withinReach = dist < (p.size + 70);
          }
          // During combat, TAB Dock/Land requires being within E interaction range.
          // Hyperdrive inter-system jumps are always available (handled below).
          const disabled = piratesPresent && !withinReach;
          const row = document.createElement('div');
          row.className = 'menu-row';
          row.innerHTML =
            '<div class="name"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' +
            info.color + ';margin-right:7px;box-shadow:0 0 6px ' + info.color + '"></span>' +
            info.name + '<small>' + info.sub + ' · ' + dist + 'u</small></div>' +
            '<div class="price">' + (b.kind === 'station' ? 'DOCK HUB' : 'LANDABLE') + '</div>';
          const btn = document.createElement('button');
          btn.className = 'menu-btn';
          btn.textContent = b.kind === 'station' ? 'DOCK' : 'LAND';
          btn.disabled = disabled;
          btn.addEventListener('click', () => {
            this.menuClose();
            const S = window.Space;
            if(S.jumpTo(b.kind, b.idx)){
              if(b.kind === 'station') this.openStation(b.idx);
              else this.landOn(b.idx);
            }
          });
          row.appendChild(btn);
          m.appendChild(row);
        }
      }

      // ---------- HYPERSPACE: all systems, current one identified ----------
      const hypHead = document.createElement('div');
      hypHead.innerHTML = '<div class="bar-label" style="margin:14px 0 6px;color:#8fc6d8">HYPERSPACE</div>';
      m.appendChild(hypHead);
      for(const sys of this.GALAXY){
        const hereSys = sys.sys === curSys;
        const sh = document.createElement('div');
        sh.innerHTML = '<div class="bar-label" style="margin:8px 0 0' +
          (hereSys ? ';color:#5ff0ff' : '') + '">' + sys.name +
          (hereSys ? ' ◀ CURRENT' : '') + '</div>';
        m.appendChild(sh);
        if(hereSys) continue;
        const row = document.createElement('div');
        row.className = 'menu-row';
        row.innerHTML = '<div class="name">' + sys.name + '<small>' + (hasHD ? 'HYPERDRIVE READY' : 'HYPERDRIVE REQUIRED') + '</small></div>' +
          '<div class="price">' + (hasHD ? 'JUMP TO SYSTEM' : 'NO JUMP — HYPERDRIVE REQUIRED') + '</div>';
        if(hasHD){
          const btn = document.createElement('button');
          btn.className = 'menu-btn';
          btn.textContent = 'JUMP TO ' + sys.name;
          btn.addEventListener('click', () => { this._pendingJump = { system: sys.sys }; this._renderGalaxy(); });
          row.appendChild(btn);
        }
        m.appendChild(row);
      }
      if(this._pendingJump){
        const pj = this._pendingJump;
        const pRow = document.createElement('div');
        pRow.className = 'menu-row';
        pRow.innerHTML = '<div class="name">JUMP TO ' + window.SYSTEMS[pj.system].name + '?</div>' +
          '<div class="price">CONFIRM HYPERSPACE TRAVEL</div>';
        const yes = document.createElement('button');
        yes.className = 'menu-btn';
        yes.textContent = 'CONFIRM';
        yes.addEventListener('click', () => this._confirmHyperspace());
        const no = document.createElement('button');
        no.className = 'menu-btn';
        no.textContent = 'CANCEL';
        no.addEventListener('click', () => { this._pendingJump = null; this._renderGalaxy(); });
        pRow.appendChild(yes);
        pRow.appendChild(no);
        m.appendChild(pRow);
      }

      // ---------- ACTIVE MISSIONS ----------
      const misHead = document.createElement('div');
      misHead.innerHTML = '<div class="bar-label" style="margin:14px 0 6px;color:#c48bff">ACTIVE MISSIONS</div>';
      m.appendChild(misHead);
      if(!window.PD.missions.length){
        const none = document.createElement('div');
        none.style.cssText = 'color:#8fc6d8;font-size:11px;text-align:center;margin-bottom:8px';
        none.textContent = 'No active contracts — accept one from the station lounge.';
        m.appendChild(none);
      }
      for(const mi of window.PD.missions){
        const prog = mi.type === 'delivery'
          ? 'carrying ' + Math.min(window.PD.trade[mi.good] | 0, mi.qty) + '/' + mi.qty + ' · reward ' + mi.reward + ' CR'
          : mi.type === 'passenger' ? 'ferry to ' + mi.dest.name
          : (mi.have | 0) + '/' + mi.need;
        const destSys = mi.dest ? window.PD.systemName(window.PD.systemOf(mi.dest.kind, mi.dest.idx)) : '';
        const row = document.createElement('div');
        row.className = 'menu-row';
        row.innerHTML = '<div class="name">' + mi.label + '<small>' + (mi.desc || '') + '</small></div>' +
          '<div class="price">' + prog + (mi.dest ? ' · → ' + mi.dest.name + ' [' + destSys + ']' : '') + '</div>';
        m.appendChild(row);
      }

      const d = document.createElement('div');
      d.style.cssText = 'color:#8fc6d8;font-size:11px;text-align:center;margin-top:10px';
      d.textContent = 'Local jumps need no hyperdrive. Inter-system jumps require the Hyperdrive module and cannot run with hostiles within 700u.';
      m.appendChild(d);
      const close = document.createElement('button');
      close.className = 'menu-btn menu-close';
      close.textContent = 'CLOSE MAP  [TAB]';
      close.addEventListener('click', () => this.menuClose());
      m.appendChild(close);
    },

    // Tab > Controls: a single authoritative reference for the bindings the
    // game actually implements. Opened from the galaxy map; Back returns there.
    _renderControls(){
      const m = this.els.menuInner;
      m.innerHTML = '<h2>CONTROLS</h2><div class="sub">Actual keyboard bindings · [TAB] / [E] / [ESC] to close</div>';
      const groups = [
        { title: 'SPACE FLIGHT & NAVIGATION', rows: [
          ['W / S', 'pitch the nose up / down'],
          ['A / D', 'turn left / right'],
          ['B hold', 'increase engine thrust'],
          ['N hold', 'decrease engine thrust / brake'],
          ['Q', 'quick-travel to the scanned planet or station'],
          ['TAB', 'open / close the galaxy map'],
          ['E', 'dock at a station or land on a planet when prompted']
        ]},
        { title: 'WEAPONS & COMBAT', rows: [
          ['SPACE / LMB', 'fire ship lasers (works at any speed, including zero thrust)'],
          ['HOLD CROSSHAIR', 'lock a target (scanner level sets lock time)'],
          ['G', 'launch a homing missile — requires Homing Missile System + ammo'],
          ['F', 'fire EMP pulse — requires EMP Emitter'],
          ['Q', 'quick-travel only when no hostiles are within 700u']
        ]},
        { title: 'PLANETARY MOVEMENT & COMBAT', rows: [
          ['W / A / S / D', 'walk on the surface'],
          ['SPACE / LMB', 'fire the equipped planetary weapon (uses Pulse Rounds)'],
          ['G', 'cycle equipped planetary weapon'],
          ['1 / 2', 'equip Laser Pistol / Assault Rifle'],
          ['H', 'use a Medkit'],
          ['R', 'take off when near your ship']
        ]},
        { title: 'INTERACTION & MINING', rows: [
          ['E', 'land / dock / talk to a trader / collect salvage'],
          ['HOLD E', 'mine ore, chop wood, harvest crystals, repair your ship'],
          ['R', 'take off from a planet'],
          ['E', 'close an open menu']
        ]},
        { title: 'MENUS & GENERAL', rows: [
          ['TAB', 'galaxy map (this menu holds the Controls panel)'],
          ['E / ESC', 'close the current menu'],
          ['M', 'mute / unmute sound'],
          ['MOUSE', 'click menu buttons and category tabs']
        ]},
        { title: 'EQUIPMENT-DEPENDENT CONTROLS', rows: [
          ['F', 'EMP Emitter — non-lethal pirate disable'],
          ['G', 'Homing Missile System — launch guided missile'],
          ['TAB', 'Hyperdrive — inter-system jumps from the galaxy map'],
          ['—', 'Passenger Module — required to accept ferry missions'],
          ['—', 'Target Scanner — shortens lock-on time']
        ]}
      ];
      for(const g of groups){
        const h = document.createElement('div');
        h.innerHTML = '<div class="bar-label" style="margin:12px 0 6px;color:#5ff0ff">' + g.title + '</div>';
        m.appendChild(h);
        for(const r of g.rows){
          const row = document.createElement('div');
          row.className = 'menu-row';
          row.innerHTML = '<div class="name">' + r[1] + '</div>' +
            '<div class="price" style="color:#5ff0ff;min-width:110px">' + r[0] + '</div>';
          m.appendChild(row);
        }
      }
      const back = document.createElement('button');
      back.className = 'menu-btn menu-close';
      back.textContent = '◀ BACK TO GALAXY MAP';
      back.addEventListener('click', () => { window.GameAudio.uiClick(); this._renderGalaxy(); });
      m.appendChild(back);
    },

    // Stage C: hyperspace confirmation -> start the jump (arrival persists system)
    _confirmHyperspace(){
      const pj = this._pendingJump;
      if(!pj) return;
      const si = pj.system | 0;
      const cur = window.PD.systemIdx | 0;
      if(si === cur){ this._pendingJump = null; this._renderGalaxy(); return; }
      if(window.PD.crashRecovery && window.PD.crashRecovery.active){
        this._pendingJump = null;
        this.uiToast('SHIP DAMAGED — repair the wreck before travel');
        this._renderGalaxy();
        return;
      }
      if(!window.PD.hasModule('hyperdrive')){
        this._pendingJump = null;
        this.uiToast('✖ HYPERDRIVE REQUIRED — dock at a station to buy the module');
        this._renderGalaxy();
        return;
      }
      // same combat rule as the quick-travel jump: no hyperspace while hostiles are in range
      let blocked = false;
      for(const e of window.Space.pirates){
        if(e.mesh.position.distanceTo(window.Space.ship.position) < 700){ blocked = true; break; }
      }
      if(blocked){
        window.GameAudio.alarm();
        this.uiToast('✖ JUMP BLOCKED — HOSTILES IN RANGE (clear nearby pirates first)');
        this._renderGalaxy();
        return;
      }
      // jump approved: clear pending jump and initiate
      this._pendingJump = null;
      this.menuClose();
      window.GameAudio.warp();
      if(window.PD.missionBoards) delete window.PD.missionBoards[cur]; // refresh departing system's board
      const ok = window.Space.hyperspaceToSystem(si);
      if(!ok) this._renderGalaxy();
      // Living world: vendors of the system we are leaving rotate to fresh
      // stock. Destination vendors keep whatever stock they already had; the
      // new rotation takes effect on the next visit.
      window.PD.rotateStockForSystem(cur);
    },

    _renderEquipment(m){
      const PD = window.PD;
      // PLANETARY GEAR
      const pg = document.createElement('div');
      pg.innerHTML = '<div class="bar-label" style="margin:12px 0 6px">PLANETARY GEAR</div>';
      m.appendChild(pg);
      // medkit
      this._row(m, 'Medkit', 'heals 55 player health [H] · you carry ' + window.PD.medkits, '60 CR', 'BUY', () => {
        if(window.PD.credits < 60) return;
        window.PD.credits -= 60; window.PD.medkits++; window.GameAudio.uiBuy(); window.PD.save(); this._renderStation();
      }, window.PD.credits < 60);
      const stock = this._marketStock('station');
      const laser = window.WEAPON_DEFS.laserpistol;
      const laserOwned = PD.hasWeapon('laserpistol');
      const laserInStock = (stock.weapons.laserpistol || 0) > 0;
      if(laserOwned){
        this._row(m, laser.name, laser.desc + ' · [SPACE] fire · dmg ' + laser.dmg + ' · delay ' + laser.delay.toFixed(2) + 's', 'sell ' + Math.round(laser.cost * 0.6) + ' CR', 'SELL', () => {
          const refund = PD.sellWeapon('laserpistol');
          window.GameAudio.coin();
          window.PD.save();
          this.uiToast('Sold ' + laser.name + ' · +' + refund + ' CR');
          this._renderStation();
        }, false);
      } else if(laserInStock){
        this._row(m, laser.name, laser.desc + ' · [SPACE] fire · dmg ' + laser.dmg + ' · delay ' + laser.delay.toFixed(2) + 's', laser.cost + ' CR', 'BUY', () => {
          if(PD.credits < laser.cost) return;
          PD.credits -= laser.cost;
          PD.weapons.push('laserpistol');
          if(!PD.equippedWeapon) PD.equippedWeapon = 'laserpistol';
          delete stock.weapons.laserpistol;
          window.GameAudio.uiBuy();
          window.PD.save();
          this._renderStation();
        }, false);
      } else {
        this._row(m, laser.name, laser.desc + ' · [SPACE] fire · dmg ' + laser.dmg + ' · delay ' + laser.delay.toFixed(2) + 's', 'not in stock', '—', () => {}, true);
      }
      const rifle = window.WEAPON_DEFS.assaultrifle;
      const rifleOwned = PD.hasWeapon('assaultrifle');
      const rifleInStock = (stock.weapons.assaultrifle || 0) > 0;
      if(rifleOwned){
        this._row(m, rifle.name, rifle.desc + ' · [SPACE] fire · dmg ' + rifle.dmg + ' · delay ' + rifle.delay.toFixed(2) + 's', 'sell ' + Math.round(rifle.cost * 0.6) + ' CR', 'SELL', () => {
          const refund = PD.sellWeapon('assaultrifle');
          window.GameAudio.coin();
          window.PD.save();
          this.uiToast('Sold ' + rifle.name + ' · +' + refund + ' CR');
          this._renderStation();
        }, false);
      } else if(rifleInStock){
        this._row(m, rifle.name, rifle.desc + ' · [SPACE] fire · dmg ' + rifle.dmg + ' · delay ' + rifle.delay.toFixed(2) + 's', rifle.cost + ' CR', 'BUY', () => {
          if(PD.credits < rifle.cost) return;
          PD.credits -= rifle.cost;
          PD.weapons.push('assaultrifle');
          if(!PD.equippedWeapon) PD.equippedWeapon = 'assaultrifle';
          delete stock.weapons.assaultrifle;
          window.GameAudio.uiBuy();
          window.PD.save();
          this._renderStation();
        }, false);
      } else {
        this._row(m, rifle.name, rifle.desc + ' · [SPACE] fire · dmg ' + rifle.dmg + ' · delay ' + rifle.delay.toFixed(2) + 's', 'not in stock', '—', () => {}, true);
      }
      if(stock.energyCells > 0){
        this._row(m, 'Pulse Rounds', 'ammo for [SPACE] ranged weapons · ' + stock.energyCells + ' in stock', '25 CR', 'BUY', () => {
          if(PD.credits < 25) return;
          PD.credits -= 25;
          PD.energyCells++;
          stock.energyCells--;
          window.GameAudio.uiBuy();
          window.PD.save();
          this._renderStation();
        }, false);
      } else {
        this._row(m, 'Pulse Rounds', 'ammo for [SPACE] ranged weapons · out of stock', '25 CR', '—', () => {}, true);
      }
      if(PD.energyCells > 0){
        this._row(m, 'Sell Pulse Rounds', 'sell all ammo · refund 9 CR each', PD.energyCells + ' × 9 CR', 'SELL', () => {
          const refund = PD.sellEnergyCells(PD.energyCells);
          window.GameAudio.coin();
          window.PD.save();
          this.uiToast('Sold energy cells · +' + refund + ' CR');
          this._renderStation();
        }, false);
      }
      // repair ship

      const missingHull = Math.ceil(PD.hullMax() - PD.hp);
      if(missingHull > 0){
        const repairCost = Math.ceil(missingHull * 2);
        if(this._pendingRepair){
          // confirmation dialog: plain info row + CONFIRM/CANCEL (no action
          // button on the info row, so no empty button shell is left behind)
          const confRow = document.createElement('div');
          confRow.className = 'menu-row';
          confRow.innerHTML = '<div class="name">REPAIR CONFIRMATION</div><div class="price">restore hull to max · cost ' + repairCost + ' CR</div>';
          m.appendChild(confRow);
          const yesBtn = document.createElement('button');
          yesBtn.className = 'menu-btn';
          yesBtn.textContent = 'CONFIRM';
          yesBtn.addEventListener('click', () => {
            if(PD.credits < repairCost){
              window.GameAudio.alarm();
              window.Game.uiToast('✖ INSUFFICIENT CREDITS FOR REPAIR');
            } else {
              PD.credits -= repairCost;
              PD.hp = PD.hullMax();
              window.GameAudio.uiBuy();
              window.PD.save();
              this._pendingRepair = null;
              this._renderStation();
            }
          });
          m.appendChild(yesBtn);
          const noBtn = document.createElement('button');
          noBtn.className = 'menu-btn';
          noBtn.textContent = 'CANCEL';
          noBtn.addEventListener('click', () => {
            this._pendingRepair = null;
            this._renderStation();
          });
          m.appendChild(noBtn);
        } else {
          this._row(m, 'Repair Ship', 'restore hull to max · missing ' + missingHull, repairCost + ' CR', 'REPAIR', () => {
            this._pendingRepair = { cost: repairCost };
            this._renderStation();
          }, false);
        }
      }
      // SHIP GEAR
      const sg = document.createElement('div');
      sg.innerHTML = '<div class="bar-label" style="margin:12px 0 6px">SHIP GEAR</div>';
      m.appendChild(sg);
      if(stock.missiles > 0){
        this._row(m, 'Missiles', '[G] homing missile ammunition · ' + stock.missiles + ' in stock', '60 CR', 'BUY', () => {
          if(PD.credits < 60) return;
          PD.credits -= 60;
          PD.missiles++;
          stock.missiles--;
          window.GameAudio.uiBuy();
          window.PD.save();
          this._renderStation();
        }, false);
      } else {
        this._row(m, 'Missiles', '[G] homing missile ammunition · out of stock', '60 CR', '—', () => {}, true);
      }
      if(PD.missiles > 0){
        this._row(m, 'Sell Missiles', 'sell all missiles · refund 25 CR each', PD.missiles + ' × 25 CR', 'SELL', () => {
          const refund = PD.missiles * 25;
          PD.credits += refund;
          PD.missiles = 0;
          window.GameAudio.coin();
          window.PD.save();
          this.uiToast('Sold missiles · +' + refund + ' CR');
          this._renderStation();
        }, false);
      }
      // ship upgrades
      const uh = document.createElement('div');
      uh.innerHTML = '<div class="bar-label" style="margin:12px 0 6px">SHIP UPGRADES</div>';
      m.appendChild(uh);
      const ups = [
        { k: 'weapon',  name: 'Laser Cannon',   desc: 'damage & fire rate', cost: l => 220 + l * 180 },
        { k: 'engine',  name: 'Ion Engine',     desc: 'thrust & max speed', cost: l => 180 + l * 150 },
        { k: 'hull',    name: 'Hull Plating',   desc: 'max hull & cargo',   cost: l => 200 + l * 160 },
        { k: 'shield',  name: 'Deflector Grid', desc: 'regenerating shield',cost: l => 260 + l * 200 },
        { k: 'scanner', name: 'Target Scanner', desc: 'faster lock-on (L1 3.0s → L5 0.5s)', cost: l => 240 + l * 170 }
      ];
      for(const u of ups){
        const lvl = window.PD.up[u.k];
        if(lvl >= 5){
          this._row(m, u.name, u.desc, '', this._lvl(lvl), () => {}, true);
          continue;
        }
        const cost = u.cost(lvl);
        this._row(m, u.name + '  <span class="lvl">' + this._lvl(lvl) + '</span>', u.desc,
          cost + ' CR', 'UPGRADE', () => {
            if(window.PD.credits < cost) return;
            window.PD.credits -= cost;
            window.PD.up[u.k]++;
            if(u.k === 'hull') window.PD.hp = window.PD.hullMax();
            window.GameAudio.uiBuy();
            window.PD.save();
            this._renderStation();
          }, window.PD.credits < cost);
      }
      // equipment modules: install / uninstall / buy / sell
      const mh = document.createElement('div');
      mh.innerHTML = '<div class="bar-label" style="margin:12px 0 6px">SHIP MODULES  <span>' +
        PD.installed.length + '/' + window.MODULE_SLOTS + ' slots · hold ' + PD.modules.length +
        '/' + window.MODULE_STORE_CAP + '</span></div>';
      m.appendChild(mh);
      for(const k in window.MODULE_DEFS){
        const def = window.MODULE_DEFS[k];
        const installed = PD.installed.indexOf(k) >= 0;
        const stored = PD.hasModuleStored(k);
        if(installed){
          this._row(m, def.name, def.desc + ' · active', '', 'UNINSTALL', () => {
            PD.installed.splice(PD.installed.indexOf(k), 1);
            if(PD.modules.length < window.MODULE_STORE_CAP) PD.modules.push(k);
            else { PD.credits += Math.round(def.cost * 0.6); window.Game.uiToast('+ ' + Math.round(def.cost * 0.6) + ' CR (hold full — sold)'); }
            window.GameAudio.uiClick();
            window.PD.save();
            this._renderStation();
          });
        } else if(stored){
          this._row(m, def.name, def.desc + ' · in module hold', '', 'INSTALL', () => {
            if(PD.installed.length >= window.MODULE_SLOTS){ window.Game.uiToast('✖ ALL MODULE SLOTS FULL'); return; }
            PD.modules.splice(PD.modules.indexOf(k), 1);
            PD.installed.push(k);
            window.GameAudio.uiBuy();
            window.PD.save();
            this._renderStation();
          });
          // sell a spare module from the hold
          this._row(m, def.name, 'sell spare module', Math.round(def.cost * 0.6) + ' CR', 'SELL', () => {
            PD.modules.splice(PD.modules.indexOf(k), 1);
            PD.credits += Math.round(def.cost * 0.6);
            window.GameAudio.coin();
            window.PD.save();
            this._renderStation();
          });
        } else {
          this._row(m, def.name, def.desc, def.cost + ' CR', 'BUY', () => {
            if(PD.credits < def.cost) return;
            if(PD.modules.length >= window.MODULE_STORE_CAP){ window.Game.uiToast('✖ MODULE HOLD FULL — install or sell spares'); return; }
            PD.credits -= def.cost;
            PD.modules.push(k);
            window.GameAudio.uiBuy();
            window.PD.save();
            this._renderStation();
          }, PD.credits < def.cost);
        }
      }
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#8fc6d8;font-size:11px;text-align:center;margin-top:8px';
      hint.textContent = 'Uninstalled modules sit in the ship\'s module hold (' + window.MODULE_STORE_CAP + ' max).';
      m.appendChild(hint);
    },

    _renderMarket(m){
      const PD = window.PD;
      // sell raw cargo
      const sellH = document.createElement('div');
      sellH.innerHTML = '<div class="bar-label" style="margin-bottom:6px">SELL CARGO</div>';
      m.appendChild(sellH);
      let any = false;
      for(const k in window.COMMS){
        const n = window.PD.cargo[k] | 0;
        if(n <= 0) continue;
        any = true;
        const price = window.PD.priceSell(k, 'peaceful');
        this._row(m, window.COMMS[k].name + ' ×' + n, 'unit price ' + price + ' CR',
          (price * n) + ' CR', 'SELL ALL', () => {
            window.PD.credits += price * n;
            window.PD.cargo[k] = 0;
            window.GameAudio.coin();
            window.PD.save();
            this._renderStation();
          });
      }
      if(!any){
        const d = document.createElement('div');
        d.style.cssText = 'color:#8fc6d8;font-size:12px;text-align:center;margin-bottom:10px';
        d.textContent = 'Cargo hold is empty — mine asteroids to gather Iron Ore.';
        m.appendChild(d);
      }
      // commodity exchange
      const h = document.createElement('div');
      h.innerHTML = '<div class="bar-label" style="margin:12px 0 6px">COMMODITY EXCHANGE <span>buy low · sell high</span></div>';
      m.appendChild(h);
      for(const g in window.TRADE_GOODS){
        const def = window.TRADE_GOODS[g];
        const buy = PD.tradeBuyPrice(g, 'station');
        const sell = PD.tradeSellPrice(g, 'station');
        const held = PD.trade[g] | 0;
        const row = document.createElement('div');
        row.className = 'menu-row';
        row.innerHTML =
          '<div class="name">' + def.name +
            (held ? ' ×' + held : '') +
            '<small>' + this._priceLine(g) + '</small></div>' +
          '<div class="price">buy ' + buy + '<br>sell ' + sell + '</div>';
        const buyBtn = document.createElement('button');
        buyBtn.className = 'menu-btn';
        buyBtn.textContent = 'BUY 10';
        buyBtn.disabled = PD.credits < buy * 10 || PD.cargoUsed() >= PD.cargoMax();
        buyBtn.addEventListener('click', () => {
          const got = PD.buyTradeGood(g, 'station', 10);
          if(got > 0){ window.GameAudio.coin(); PD.save(); }
          else window.GameAudio.uiClick();
          this._renderStation();
        });
        const sellBtn = document.createElement('button');
        sellBtn.className = 'menu-btn';
        sellBtn.textContent = 'SELL ALL';
        sellBtn.style.marginLeft = '6px';
        sellBtn.disabled = held <= 0;
        sellBtn.addEventListener('click', () => {
          const n = PD.sellTradeGood(g, 'station', held);
          if(n > 0){ window.GameAudio.coin(); PD.save(); }
          this._renderStation();
        });
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.appendChild(buyBtn);
        wrap.appendChild(sellBtn);
        row.appendChild(wrap);
        m.appendChild(row);
      }
      const d = document.createElement('div');
      d.style.cssText = 'color:#8fc6d8;font-size:11px;text-align:center;margin-top:10px';
      d.textContent = 'Procedural economy — prices reshuffle on every visit. Outposts on Terra, Verdant & Novara trade too.';
      m.appendChild(d);
    },

    _renderTrade(){
      const PD = window.PD;
      const m = this.els.menuInner;
      const mk = 'p' + window.PD.planetIndex;
      m.innerHTML = '<h2>COLONIST OUTPOST</h2><div class="sub">"Fresh supplies, off-worlder." — ◈ ' +
        window.PD.credits + ' CR · cargo ' + PD.cargoUsed() + '/' + PD.cargoMax() + '</div>';
      // commodity exchange at planet prices
      const gh = document.createElement('div');
      gh.innerHTML = '<div class="bar-label" style="margin-bottom:6px">COMMODITY EXCHANGE</div>';
      m.appendChild(gh);
      for(const g in window.TRADE_GOODS){
        const def = window.TRADE_GOODS[g];
        const buy = PD.tradeBuyPrice(g, mk);
        const sell = PD.tradeSellPrice(g, mk);
        const held = PD.trade[g] | 0;
        const row = document.createElement('div');
        row.className = 'menu-row';
        row.innerHTML =
          '<div class="name">' + def.name + (held ? ' ×' + held : '') +
            '<small>' + this._priceLine(g) + '</small></div>' +
          '<div class="price">buy ' + buy + '<br>sell ' + sell + '</div>';
        const buyBtn = document.createElement('button');
        buyBtn.className = 'menu-btn';
        buyBtn.textContent = 'BUY 10';
        buyBtn.disabled = PD.credits < buy * 10 || PD.cargoUsed() >= PD.cargoMax();
        buyBtn.addEventListener('click', () => {
          const got = PD.buyTradeGood(g, mk, 10);
          if(got > 0){ window.GameAudio.coin(); PD.save(); }
          else window.GameAudio.uiClick();
          this._renderTrade();
        });
        const sellBtn = document.createElement('button');
        sellBtn.className = 'menu-btn';
        sellBtn.textContent = 'SELL ALL';
        sellBtn.style.marginLeft = '6px';
        sellBtn.disabled = held <= 0;
        sellBtn.addEventListener('click', () => {
          const n = PD.sellTradeGood(g, mk, held);
          if(n > 0){ window.GameAudio.coin(); PD.save(); }
          this._renderTrade();
        });
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.appendChild(buyBtn);
        wrap.appendChild(sellBtn);
        row.appendChild(wrap);
        m.appendChild(row);
      }
      const sh = document.createElement('div');
      sh.innerHTML = '<div class="bar-label" style="margin:12px 0 6px">SURFACE GOODS</div>';
      m.appendChild(sh);
      for(const k in window.COMMS){
        const n = window.PD.cargo[k] | 0;
        if(n <= 0) continue;
        const price = window.PD.priceSell(k, window.Planet.planet.type);
        this._row(m, window.COMMS[k].name + ' ×' + n, 'local price ' + price + ' CR',
          (price * n) + ' CR', 'SELL ALL', () => {
            window.PD.credits += price * n;
            window.PD.cargo[k] = 0;
            window.GameAudio.coin();
            window.PD.save();
            this._renderTrade();
          });
      }
      this._row(m, 'Medkit', 'heals 55 [H] · you carry ' + window.PD.medkits, '55 CR', 'BUY', () => {
        if(window.PD.credits < 55) return;
        window.PD.credits -= 55; window.PD.medkits++; window.GameAudio.uiBuy(); window.PD.save(); this._renderTrade();
      }, window.PD.credits < 55);
      this._row(m, 'Rumor', 'Krell Prime is crawling with crystals... and worse.', '10 CR', 'LISTEN', () => {
        if(window.PD.credits < 10) return;
        window.PD.credits -= 10;
        window.GameAudio.uiBuy();
        this.uiToast('"They say the purple rocks bleed credits. Just bring a fast ship."');
        this._renderTrade();
      }, window.PD.credits < 10);
      const close = document.createElement('button');
      close.className = 'menu-btn menu-close';
      close.textContent = 'LEAVE  [E]';
      close.addEventListener('click', () => this.menuClose());
      m.appendChild(close);
      // planetary gear at trader (lower stock probability)
      const tStock = this._marketStock('p' + window.PD.planetIndex);
      const pg = document.createElement('div');
      pg.innerHTML = '<div class="bar-label" style="margin:14px 0 6px">PLANETARY GEAR</div>';
      m.appendChild(pg);
      if(tStock.energyCells > 0){
        this._row(m, 'Pulse Rounds', 'ammo for [SPACE] ranged weapons · ' + tStock.energyCells + ' in stock', '30 CR', 'BUY', () => {
          if(PD.credits < 30) return;
          PD.credits -= 30;
          PD.energyCells++;
          tStock.energyCells--;
          window.GameAudio.uiBuy();
          window.PD.save();
          this._renderTrade();
        }, false);
      } else {
        this._row(m, 'Pulse Rounds', 'ammo for [SPACE] ranged weapons · out of stock', '30 CR', '—', () => {}, true);
      }
      for(const wk in window.WEAPON_DEFS){
        const wd = window.WEAPON_DEFS[wk];
        const owned = PD.hasWeapon(wk);
        const inStock = tStock.weapons[wk] > 0;
        if(owned){
          this._row(m, wd.name, 'already owned', '—', '—', () => {}, true);
        } else if(inStock){
          this._row(m, wd.name, wd.desc + ' · dmg ' + wd.dmg + ' · delay ' + wd.delay.toFixed(2) + 's', wd.cost + ' CR', 'BUY', () => {
            if(PD.credits < wd.cost) return;
            PD.credits -= wd.cost;
            PD.weapons.push(wk);
            if(!PD.equippedWeapon) PD.equippedWeapon = wk;
            delete tStock.weapons[wk];
            window.GameAudio.uiBuy();
            window.PD.save();
            this._renderTrade();
          }, false);
        } else {
          this._row(m, wd.name, wd.desc + ' · dmg ' + wd.dmg + ' · delay ' + wd.delay.toFixed(2) + 's', 'not in stock', '—', () => {}, true);
        }
      }
          },

    // ---------- HUD ----------
    uiToast(txt){
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = txt;
      this.els.toasts.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; }, 1900);
      setTimeout(() => { t.remove(); }, 2500);
      while(this.els.toasts.children.length > 4) this.els.toasts.firstChild.remove();
    },

    _fmtCargo(){
      const PD = window.PD;
      const parts = [];
      for(const k in window.PD.cargo) if(window.PD.cargo[k] > 0) parts.push(window.COMMS[k].name.split(' ')[0] + ' ×' + window.PD.cargo[k]);
      for(const k in window.PD.trade) if(window.PD.trade[k] > 0) parts.push(window.TRADE_GOODS[k].name.split(' ')[0] + ' ×' + window.PD.trade[k]);
      return parts.length ? parts.join(' · ') : 'hold empty';
    },

    _renderHudDom(){
      const PD = window.PD;
      const isPlanet = this.state === 'planet';
      // current star system readout (source of truth: SYSTEMS via PD)
      const sysEl = document.getElementById('sys-txt');
      if(sysEl) sysEl.textContent = '◈ SYSTEM · ' + PD.systemName(PD.systemIdx);
      const creditsEl = document.getElementById('credits-txt');
      if(creditsEl) creditsEl.textContent = window.PD.credits;
      // In planet mode, show player Health instead of ship Hull/Shield/Speed.
      const hpTxt = document.getElementById('hp-txt');
      const hpBar = document.getElementById('hp-bar');
      if(hpTxt && hpBar){
        if(isPlanet){
          hpTxt.textContent = Math.ceil(PD.playerHp) + '/' + PD.playerHpMax();
          hpBar.style.width = (100 * PD.playerHp / PD.playerHpMax()) + '%';
          const hpLabel = hpTxt.parentElement;
          if(hpLabel){
            // Update only the label text node, preserving the hp-txt span child
            for(const child of hpLabel.childNodes){
              if(child.nodeType === 3){
                child.textContent = 'HEALTH ';
                break;
              }
            }
          }
          // hide shield and speed bars in planet mode
          const shLabel = document.getElementById('sh-txt')?.parentElement;
          if(shLabel){ shLabel.style.display = 'none'; if(shLabel.nextElementSibling) shLabel.nextElementSibling.style.display = 'none'; }
          const spdLabel = document.getElementById('spd-txt')?.parentElement;
          if(spdLabel){ spdLabel.style.display = 'none'; if(spdLabel.nextElementSibling) spdLabel.nextElementSibling.style.display = 'none'; }
          // missiles are space-only; hide the counter row on planets
          const mslLabelP = document.getElementById('msl-label');
          if(mslLabelP) mslLabelP.style.display = 'none';
        } else {
          hpTxt.textContent = Math.ceil(window.PD.hp) + '/' + window.PD.hullMax();
          hpBar.style.width = (100 * window.PD.hp / window.PD.hullMax()) + '%';
          const hpLabel = hpTxt.parentElement;
          if(hpLabel){
            // Update only the label text node, preserving the hp-txt span child
            for(const child of hpLabel.childNodes){
              if(child.nodeType === 3){
                child.textContent = 'HULL ';
                break;
              }
            }
          }
          const shLabel = document.getElementById('sh-txt')?.parentElement;
          if(shLabel){ shLabel.style.display = ''; if(shLabel.nextElementSibling) shLabel.nextElementSibling.style.display = ''; }
          const spdLabel = document.getElementById('spd-txt')?.parentElement;
          if(spdLabel){ spdLabel.style.display = ''; if(spdLabel.nextElementSibling) spdLabel.nextElementSibling.style.display = ''; }
          const sm = window.PD.shieldMax();
          const shTxt = document.getElementById('sh-txt');
          const shBar = document.getElementById('sh-bar');
          if(shTxt) shTxt.textContent = sm ? Math.ceil(window.PD.shield) + '/' + sm : '—';
          if(shBar) shBar.style.width = sm ? (100 * window.PD.shield / sm) + '%' : '0%';
          const thr = this.state === 'space' ? (window.Space.stats.thrust || 0) : 0;
          const spdTxt = document.getElementById('spd-txt');
          const spdBar = document.getElementById('spd-bar');
          const spdLbl = document.getElementById('spd-lbl');
          if(spdTxt) spdTxt.textContent = Math.round(thr * 100) + '%';
          if(spdBar) spdBar.style.width = (100 * thr) + '%';
          if(spdLbl) spdLbl.textContent = this.state === 'space' ? 'THRUST ' : 'PLANET ';
          // missile count (only when Homing Missile System installed)
          const mslEl = document.getElementById('msl-label');
          const mslTxt = document.getElementById('msl-txt');
          const hasMsl = window.PD && window.PD.hasModule && window.PD.hasModule('missiles');
          if(mslEl) mslEl.style.display = (this.state === 'space' && hasMsl) ? '' : 'none';
          if(mslTxt) mslTxt.textContent = hasMsl ? ('×' + (window.PD.missiles | 0)) : '';
        }
      }
      document.getElementById('cargo-lines').textContent = this._fmtCargo();
      document.getElementById('cargo-txt').textContent = window.PD.cargoUsed() + '/' + window.PD.cargoMax();
      document.getElementById('cargo-bar').style.width = (100 * window.PD.cargoUsed() / window.PD.cargoMax()) + '%';
      // medkit count only visible in planetary mode
      const medkitEl = document.getElementById('medkit-txt');
      if(medkitEl){
        if(isPlanet){
          medkitEl.innerHTML = 'MEDKIT ×' + window.PD.medkits + ' <span class="key">[H]</span>';
          if(medkitEl.parentElement) medkitEl.parentElement.style.display = '';
        } else {
          if(medkitEl.parentElement) medkitEl.parentElement.style.display = 'none';
        }
      }
      // equipped weapon + energy cells in planet HUD
      if(isPlanet){
        const wepEl = document.getElementById('wep-txt');
        if(wepEl){
          if(PD.equippedWeapon){
            const w = window.WEAPON_DEFS[PD.equippedWeapon];
            // simple silhouette icon: pistol = )|  , assault rifle = )|= 
            const icon = wd => wd === 'laserpistol' ? '⚬|' : '⚬|=';
            wepEl.innerHTML = icon(PD.equippedWeapon) + ' <b>' + w.name + '</b> · PULSE ROUNDS ×' + PD.energyCells;
            // show switch hint only when both weapons owned
            if(PD.weapons.length >= 2){
              wepEl.innerHTML += '  <span style="color:#8fc6d8">[G] switch</span>';
            }
            if(wepEl.parentElement) wepEl.parentElement.style.display = '';
          } else {
            wepEl.innerHTML = 'WEAPON · NONE  PULSE ROUNDS ×' + PD.energyCells;
            if(wepEl.parentElement) wepEl.parentElement.style.display = '';
          }
        }
      }

      // prompt line
      let prompt = '';
      if(this.state === 'space'){
        if(!this.menuOpenNow && window.Space.landPrompt) prompt = window.Space.landPrompt;
        else if(!this.menuOpenNow && !window.Space.warp && window.Space.warpPrompt) prompt = window.Space.warpPrompt;
        else if(!this.menuOpenNow && !window.Space.warp) prompt = 'Press <b>TAB</b> for the galaxy map';
      } else if(this.state === 'planet'){
        prompt = window.Planet.prompt;
      }
      if(prompt && !this.menuOpenNow){
        this.els.prompt.innerHTML = prompt;
        this.els.prompt.classList.remove('hidden');
      } else {
        this.els.prompt.classList.add('hidden');
      }
    },

    _renderHudCanvas(){
      const ctx = this.hudCtx;
      const vw = ctx.canvas.width, vh = ctx.canvas.height;
      // In planet mode Planet.render owns the full canvas (terrain already painted).
      // Only clear in space mode — clearing here wiped the 2D world every frame.
      if(this.state === 'space') ctx.clearRect(0, 0, vw, vh);
      if(this.state === 'space' && !this.menuOpenNow){
        const S = window.Space;
        const hov = S.hover;
        const cx = vw / 2, cy = vh / 2;

        // warp overlay: spool ring while charging, speed lines while running
        if(S.warp){
          if(S.warp.phase === 'charge'){
            const pct = Math.min(1, S.warp.t / 0.9);
            ctx.strokeStyle = 'rgba(127,255,255,0.95)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(cx, cy, 44, -1.5708, -1.5708 + pct * 6.283);
            ctx.stroke();
            ctx.fillStyle = 'rgba(223,239,255,0.9)';
            ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('WARP SPOOLING', cx, cy + 74);
          } else {
            // radial speed lines
            ctx.strokeStyle = 'rgba(159,216,255,0.5)';
            ctx.lineWidth = 1.5;
            for(let i = 0; i < 14; i++){
              const a = (performance.now() / 240 + i * 0.449) % 6.283;
              const r0 = vh * 0.28, r1 = vh * (0.5 + 0.2 * Math.random());
              ctx.beginPath();
              ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
              ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
              ctx.stroke();
            }
            ctx.fillStyle = 'rgba(223,239,255,0.85)';
            ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('⇢ ' + S.warp.name, cx, cy + 74);
          }
        }

        // Which hovered object is the one we currently hold a lock on? A lock
        // persists even when the reticle moves away, so this must be identity
        // based rather than a single global "locked" flag.
        const pirateLocked = !!(hov && hov.type === 'pirate' && (
          (S.lockedTarget && hov.entity === S.lockedTarget) || (S.locked && !S.lockedTarget)));
        const bodyLocked = !!(hov && (hov.type === 'planet' || hov.type === 'station') && S.warpTo &&
          S.warpTo.kind === hov.type && S.warpTo.idx === parseInt(hov.id.slice(hov.type === 'planet' ? 2 : 1), 10));
        const lockedHover = pirateLocked || bodyLocked;

        // lock-on / scan progress ring around the crosshair
        let charging = false, chargeT = 0;
        if(hov && hov.type === 'pirate' && !pirateLocked && S.lockCandidateId === hov.id){
          charging = true; chargeT = S.lockT;
        } else if(hov && (hov.type === 'planet' || hov.type === 'station') && !bodyLocked && S.warpScanId === hov.id){
          charging = true; chargeT = S.warpScanT;
        }
        if(charging){
          const pct = Math.min(1, chargeT / Math.max(0.001, S.lockNeed));
          ctx.strokeStyle = 'rgba(95,240,255,0.9)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, 30, -1.5708, -1.5708 + pct * 6.283);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(95,240,255,0.18)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(cx, cy, 30, 0, 6.283); ctx.stroke();
          ctx.fillStyle = 'rgba(223,239,255,0.85)';
          ctx.font = 'bold 10px "Trebuchet MS", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('LOCKING ' + Math.round(pct * 100) + '%', cx, cy + 52);
        }

        // hovered target: brackets + info panel (Name / Type / Distance / Value)
        if(hov){
          const x = hov.x * vw, y = hov.y * vh;
          const col = lockedHover ? 'rgba(255,184,77,0.95)' :
            hov.type === 'pirate' ? 'rgba(255,95,122,0.9)' :
            hov.type === 'station' ? 'rgba(255,212,121,0.8)' :
            hov.type === 'planet' ? 'rgba(95,240,255,0.8)' : 'rgba(154,210,255,0.75)';
          const size = Math.max(9, Math.min(110, hov.size || 12));
          const g = Math.min(8, size * 0.4);
          ctx.strokeStyle = col;
          ctx.lineWidth = lockedHover ? 2 : 1.3;
          ctx.beginPath();
          ctx.moveTo(x - size, y - size + g); ctx.lineTo(x - size, y - size); ctx.lineTo(x - size + g, y - size);
          ctx.moveTo(x + size - g, y - size); ctx.lineTo(x + size, y - size); ctx.lineTo(x + size, y - size + g);
          ctx.moveTo(x + size, y + size - g); ctx.lineTo(x + size, y + size); ctx.lineTo(x + size - g, y + size);
          ctx.moveTo(x - size + g, y + size); ctx.lineTo(x - size, y + size); ctx.lineTo(x - size, y + size - g);
          ctx.stroke();
          if(lockedHover){ // rotating lock ring
            const a0 = (performance.now() / 700) % 6.283;
            ctx.strokeStyle = 'rgba(255,184,77,0.6)';
            ctx.lineWidth = 1.6;
            for(let k = 0; k < 4; k++){
              ctx.beginPath();
              ctx.arc(x, y, size + 5, a0 + k * 1.5708, a0 + k * 1.5708 + 0.9);
              ctx.stroke();
            }
          }
          // info panel to the right of the bracket
          ctx.font = '10px "Trebuchet MS", sans-serif';
          ctx.textAlign = 'left';
          const px = x + size + 12, py = y - 24;
          const lines = [
            [hov.name || 'TARGET', col],
            [hov.kind || '', 'rgba(143,198,216,0.9)'],
            ['DIST ' + Math.round(hov.dist) + 'm', 'rgba(223,239,255,0.8)'],
            [hov.value || '', 'rgba(255,212,121,0.85)']
          ];
          // Living world UI: locked enemy target shows hull health (bar + numeric)
          const healthLocked = !!(lockedHover && hov && hov.type === 'pirate');
          if(healthLocked){
            lines.push(['HULL ' + Math.ceil(hov.hp || 0) + ' / ' + Math.ceil(hov.maxHp || 0), 'rgba(255,95,122,0.9)']); // Step 3E: red enemy hull health
          }
          const bh = healthLocked ? 64 : 52;
          const bw = Math.max.apply(null, lines.map(l => ctx.measureText(l[0]).width)) + 14;
          ctx.fillStyle = 'rgba(6,16,34,0.72)';
          ctx.fillRect(px, py, bw, bh);
          ctx.strokeStyle = 'rgba(95,240,255,0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, bw, bh);
          lines.forEach((l, i) => {
            ctx.fillStyle = l[1];
            ctx.font = (i === 0 ? 'bold ' : '') + (i === 0 ? 11 : 9.5) + 'px "Trebuchet MS", sans-serif';
            ctx.fillText(l[0], px + 7, py + 14 + i * 12);
          });
          // small hull health bar under the locked enemy info panel
          if(healthLocked){
            const hbW = Math.min(bw, 96), hbH = 4;
            const hy = py + bh - 12;
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(px, hy, hbW, hbH);
            const frac = Math.max(0, Math.min(1, (hov.hp || 0) / Math.max(1, hov.maxHp || 1)));
            ctx.fillStyle = 'rgba(255,95,122,0.9)'; // Step 3E: red enemy hull health bar
            ctx.fillRect(px, hy, hbW * frac, hbH);
          }
        }

        // Persistent lock readout: remains visible after the reticle leaves the
        // target, so the player always knows a missile still has guidance.
        if(S.lockedTarget && S.lockedTarget.mesh && (!hov || hov.entity !== S.lockedTarget)){
          const lt = S.lockedTarget;
          const ld = Math.round(lt.mesh.position.distanceTo(S.ship.position));
          const lhp = Math.max(0, Math.ceil(lt.hp || 0));
          const lmax = Math.ceil((lt.type && lt.type.hp ? lt.type.hp[1] : lhp) || 1);
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(255,184,77,0.95)';
          ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
          ctx.fillText('◈ LOCKED · ' + (lt.type ? lt.type.name : 'TARGET'), cx, cy + 70);
          ctx.fillStyle = 'rgba(223,239,255,0.8)';
          ctx.font = '10px "Trebuchet MS", sans-serif';
          ctx.fillText(ld + 'm · HULL ' + lhp + ' / ' + lmax + ' · [G] MISSILE', cx, cy + 84);
        }

        // off-screen pirate warning arrows
        const targets = S._targets || [];
        for(const t of targets){
          if(t.type !== 'pirate' || t.dist > 3200) continue;
          if(t.x > -0.05 && t.x < 1.05 && t.y > -0.05 && t.y < 1.05) continue;
          const cxp = Math.max(20, Math.min(vw - 20, t.x * vw));
          const cyp = Math.max(20, Math.min(vh - 20, t.y * vh));
          ctx.fillStyle = 'rgba(255,95,122,0.8)';
          ctx.beginPath();
          ctx.arc(cxp, cyp, 5, 0, 6.283);
          ctx.fill();
        }
      }
      if(this.state === 'planet'){
        // top-center location banner (drawn over the world, no clearing)
        ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(95,240,255,0.85)';
        ctx.fillText(window.Planet.planet ? window.Planet.planet.name : '', vw / 2, 34);
        ctx.fillStyle = 'rgba(223,239,255,0.5)';
        ctx.font = '10px "Trebuchet MS", sans-serif';
        ctx.fillText(window.Planet.planet ? window.Planet.planet.type.toUpperCase() : '', vw / 2, 48);
      }
    },

    // ---------- main ----------
    update(dt){
      if(this.state === 'start') return;
      if(this.menuOpenNow){
        // world keeps rendering but pauses gameplay; E / Esc / Tab closes
        if(this.input.pressed('KeyE') || this.input.pressed('Escape') ||
          (this.galaxyOpen && this.input.pressed('Tab'))) this.menuClose();
      } else if(this.state === 'space'){
        if(this.input.pressed('Tab')) this.openGalaxy();
        else if(this.input.pressed('KeyE')){
          if(window.Space.nearStation) this.openStation();
          else if(window.Space.nearPlanet >= 0) this.landOn(window.Space.nearPlanet);
        }
        window.Space.update(dt);
        this._checkMissions();
      } else if(this.state === 'planet'){
        window.Planet.update(dt);
        this._checkMissions();
      }
      // Living world: gradual time-based natural resource regeneration across
      // all known planetary surfaces (time spent in other systems counts).
      if(window.Planet && window.Planet.regenResources){
        window.Planet.regenResources(Date.now());
      }
      this.input.pressedCodes.clear();
      if(this._closeCd > 0) this._closeCd--;
      this._renderHudDom();
    },

    render(){
      if(this.state === 'start'){
        // slow drifting starfield behind title
        const ctx = this.hudCtx;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        return;
      }
      if(this.state === 'space'){
        this.hudCtx.clearRect(0, 0, this.hudCtx.canvas.width, this.hudCtx.canvas.height);
        window.Space.render();
        this._renderHudCanvas();
      } else if(this.state === 'planet'){
        window.Space.render(); // keep GL canvas black/cleared behind
        window.Planet.render();
        this._renderHudCanvas();
      }
    }
  };

  window.addEventListener('error', e => {
    const el = document.getElementById('error-log');
    if(el){ el.style.display = 'block'; el.innerText = 'ERROR: ' + e.message + '\n' + (e.filename || '') + ':' + (e.lineno || ''); }
  });
  window.Game = G;
  // Tests load this file to inspect the derived galaxy without booting WebGL.
  if(window.__GALAXY_TEST__ !== true) window.Game.init();
})();
