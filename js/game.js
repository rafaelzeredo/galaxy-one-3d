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
        start: document.getElementById('screen-start')
      };
      this.hudCtx = this.els.hud.getContext('2d');
      this.fade = this.els.fade;
      this._bindInput();
      window.Space.init(this.els.space);
      window.Planet.init(this.hudCtx);
      const self = this;
      document.getElementById('btn-start').addEventListener('click', () => {
        window.GameAudio.init(); window.GameAudio.resume(); window.GameAudio.warp();
        self.els.start.classList.add('hidden');
        self._toSpace(true);
      });
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
        mouseX: 0, mouseY: 0, mouseDown: false,
        mouseWorldX: 0, mouseWorldY: 0,
        pressed(code){ return this.pressedCodes.has(code); }
      };
      this.input = inp;
      window.addEventListener('keydown', e => {
        const c = e.code;
        if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','KeyE','KeyR','KeyH','Tab'].indexOf(c) >= 0) e.preventDefault();
        window.GameAudio.init(); window.GameAudio.resume();
        if(!inp.keys.has(c)) inp.pressedCodes.add(c);
        inp.keys.add(c);
        if(c === 'KeyM'){ const m = window.GameAudio.toggleMute(); this.uiToast(m ? 'SOUND OFF' : 'SOUND ON'); }
      });
      window.addEventListener('keyup', e => inp.keys.delete(e.code));
      window.addEventListener('blur', () => inp.keys.clear());
      window.addEventListener('mousemove', e => {
        inp.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
        inp.mouseY = (e.clientY / window.innerHeight) * 2 - 1;
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
    },

    landOn(planetIdx){
      if(this.state !== 'space') return;
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
        // insurance: lose 25% cargo + 10% credits
        for(const k in window.PD.cargo) window.PD.cargo[k] = Math.floor(window.PD.cargo[k] * 0.75);
        window.PD.credits = Math.floor(window.PD.credits * 0.9);
        window.PD.save();
        window.Space.respawn();
        this.deathHandled = false;
        this.uiToast('SHIP REBUILT AT ORION STATION — cargo losses incurred');
      });
    },

    onPlanetDeath(){
      if(this.deathHandled) return;
      this.deathHandled = true;
      window.GameAudio.bigBoom();
      this._fade(() => {
        const PD = window.PD;
        for(const k in window.PD.cargo) window.PD.cargo[k] = Math.floor(window.PD.cargo[k] * 0.7);
        window.PD.save();
        // respawn at ship, aliens scatter a bit
        const st = window.Planet.state;
        window.Planet.player.x = st.ship.x;
        window.Planet.player.y = st.ship.y + 40;
        window.Planet.aliens = window.Planet.aliens.filter(a => Math.hypot(a.x - st.ship.x, a.y - st.ship.y) > 600);
        window.PD.resetShipState();
        window.Planet.hitFlash = 0;
        this.deathHandled = false;
        this.uiToast('EMERGENCY EVAC — you wake up aboard your ship');
      });
    },

    // ---------- menus ----------
    menuOpenNow: false,
    menuTab: 'shipyard', // station tabs: shipyard | trade
    openStation(){
      if(this.menuOpenNow) return;
      this.menuOpenNow = true;
      window.GameAudio.uiClick();
      this._renderStation();
      this.els.menu.classList.remove('hidden');
    },
    openTrade(){
      if(this.menuOpenNow) return;
      this.menuOpenNow = true;
      window.GameAudio.uiClick();
      this._renderTrade();
      this.els.menu.classList.remove('hidden');
    },
    menuClose(){
      this.menuOpenNow = false;
      this.els.menu.classList.add('hidden');
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
        const reachable = mk === 'station' || mk === 'p0' || mk === 'p1';
        parts.push(window.MARKET_NAMES[mk] + ' ' +
          (reachable ? window.PD.tradeBuyPrice(good, mk) : '—'));
      }
      return parts.join(' · ');
    },

    _renderStation(){
      const PD = window.PD;
      const m = this.els.menuInner;
      m.innerHTML = '<h2>ORION STATION</h2><div class="sub">◈ ' + PD.credits + ' CR · cargo ' +
        PD.cargoUsed() + '/' + PD.cargoMax() + '</div>';
      this._tabs(m, [{ id: 'shipyard', label: 'SHIPYARD' }, { id: 'trade', label: 'TRADE' }],
        this.menuTab, id => { this.menuTab = id; window.GameAudio.uiClick(); this._renderStation(); });

      if(this.menuTab === 'trade'){
        const h = document.createElement('div');
        h.innerHTML = '<div class="bar-label" style="margin-bottom:6px">COMMODITY EXCHANGE <span>buy low · sell high</span></div>';
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
        d.textContent = 'Colonists on Terra Prime & Verdant trade at different prices.';
        m.appendChild(d);
      } else {
        this._renderShipyard(m);
      }
      const close = document.createElement('button');
      close.className = 'menu-btn menu-close';
      close.textContent = 'UNDOCK  [E]';
      close.addEventListener('click', () => this.menuClose());
      m.appendChild(close);
    },

    _renderShipyard(m){
      const PD = window.PD;
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
      // medkit
      this._row(m, 'Medkit', 'heals 55 hull · you carry ' + window.PD.medkits, '60 CR', 'BUY', () => {
        if(window.PD.credits < 60) return;
        window.PD.credits -= 60; window.PD.medkits++; window.GameAudio.uiBuy(); window.PD.save(); this._renderStation();
      }, window.PD.credits < 60);
      // upgrades
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
      this._row(m, 'Medkit', 'heals 55 · you carry ' + window.PD.medkits, '55 CR', 'BUY', () => {
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
      document.getElementById('credits-txt').textContent = window.PD.credits;
      document.getElementById('hp-txt').textContent = Math.ceil(window.PD.hp) + '/' + window.PD.hullMax();
      document.getElementById('hp-bar').style.width = (100 * window.PD.hp / window.PD.hullMax()) + '%';
      const sm = window.PD.shieldMax();
      document.getElementById('sh-txt').textContent = sm ? Math.ceil(window.PD.shield) + '/' + sm : '—';
      document.getElementById('sh-bar').style.width = sm ? (100 * window.PD.shield / sm) + '%' : '0%';
      const spd = this.state === 'space' ? window.Space.stats.speed : 0;
      document.getElementById('spd-txt').textContent = Math.round(spd) + ' u/s';
      document.getElementById('spd-bar').style.width = (100 * spd / window.PD.maxSpeed()) + '%';
      document.getElementById('spd-lbl').textContent = this.state === 'space' ? 'SPEED ' : 'PLANET ';
      document.getElementById('cargo-lines').textContent = this._fmtCargo();
      document.getElementById('cargo-txt').textContent = window.PD.cargoUsed() + '/' + window.PD.cargoMax();
      document.getElementById('cargo-bar').style.width = (100 * window.PD.cargoUsed() / window.PD.cargoMax()) + '%';
      document.getElementById('medkit-txt').innerHTML = 'MEDKIT ×' + window.PD.medkits + ' <span class="key">[H]</span>';

      // prompt line
      let prompt = '';
      if(this.state === 'space'){
        if(!this.menuOpenNow && window.Space.landPrompt) prompt = window.Space.landPrompt;
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

        // lock-on progress ring around the crosshair
        if(hov && !S.locked){
          const pct = Math.min(1, S.lockT / S.lockNeed);
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
          const col = S.locked ? 'rgba(255,184,77,0.95)' :
            hov.type === 'pirate' ? 'rgba(255,95,122,0.9)' :
            hov.type === 'station' ? 'rgba(255,212,121,0.8)' :
            hov.type === 'planet' ? 'rgba(95,240,255,0.8)' : 'rgba(154,210,255,0.75)';
          const size = Math.max(9, Math.min(110, hov.size || 12));
          const g = Math.min(8, size * 0.4);
          ctx.strokeStyle = col;
          ctx.lineWidth = S.locked ? 2 : 1.3;
          ctx.beginPath();
          ctx.moveTo(x - size, y - size + g); ctx.lineTo(x - size, y - size); ctx.lineTo(x - size + g, y - size);
          ctx.moveTo(x + size - g, y - size); ctx.lineTo(x + size, y - size); ctx.lineTo(x + size, y - size + g);
          ctx.moveTo(x + size, y + size - g); ctx.lineTo(x + size, y + size); ctx.lineTo(x + size - g, y + size);
          ctx.moveTo(x - size + g, y + size); ctx.lineTo(x - size, y + size); ctx.lineTo(x - size, y + size - g);
          ctx.stroke();
          if(S.locked){ // rotating lock ring
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
          const bw = Math.max.apply(null, lines.map(l => ctx.measureText(l[0]).width)) + 14;
          ctx.fillStyle = 'rgba(6,16,34,0.72)';
          ctx.fillRect(px, py, bw, 52);
          ctx.strokeStyle = 'rgba(95,240,255,0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, bw, 52);
          lines.forEach((l, i) => {
            ctx.fillStyle = l[1];
            ctx.font = (i === 0 ? 'bold ' : '') + (i === 0 ? 11 : 9.5) + 'px "Trebuchet MS", sans-serif';
            ctx.fillText(l[0], px + 7, py + 14 + i * 12);
          });
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
        // world keeps rendering but pauses gameplay; E / Esc closes
        if(this.input.pressed('KeyE') || this.input.pressed('Escape')) this.menuClose();
      } else if(this.state === 'space'){
        if(this.input.pressed('KeyE')){
          if(window.Space.nearStation) this.openStation();
          else if(window.Space.nearPlanet >= 0) this.landOn(window.Space.nearPlanet);
        }
        window.Space.update(dt);
      } else if(this.state === 'planet'){
        window.Planet.update(dt);
      }
      this.input.pressedCodes.clear();
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
  window.Game.init();
})();
