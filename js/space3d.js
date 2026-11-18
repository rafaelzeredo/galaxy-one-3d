(function(){
  'use strict';
  // 3D space mode: Three.js flight, laser mining, pirates, station docking.
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- pirate raider archetypes -------------------------------------------------
  // Distinct hulls with their own silhouette, palette, armour, speed, damage, fire
  // cadence, engagement range and bounty. Stats are tuned so the baseline VOID
  // RAIDER keeps the original feel; the others trade off along one axis each.
  // `minWeapon` gates heavier hulls until the player's guns can answer them.
  const PIRATE_TYPES = [
    { key: 'raider', name: 'VOID RAIDER', scale: 1.00,
      hp: [26, 44], speed: 55, dmg: 7, fire: [1.1, 1.9], range: 380,
      bounty: [40, 100], minWeapon: 1, weight: 10,
      hull: 0x9a3546, glow: 0xff5f7a, engine: 0xff6a3d },
    { key: 'stalker', name: 'VOID STALKER', scale: 0.80,
      hp: [16, 26], speed: 78, dmg: 5, fire: [1.2, 2.0], range: 340,
      bounty: [35, 65], minWeapon: 1, weight: 7,
      hull: 0x2f5f70, glow: 0x5fd8ff, engine: 0x5fd8ff },
    { key: 'marauder', name: 'VOID MARAUDER', scale: 1.18,
      hp: [42, 60], speed: 40, dmg: 9, fire: [0.85, 1.4], range: 430,
      bounty: [70, 120], minWeapon: 1, weight: 5,
      hull: 0x6a4fb0, glow: 0xc06bf0, engine: 0x9f6bff },
    { key: 'warlord', name: 'VOID WARLORD', scale: 1.60,
      hp: [75, 105], speed: 30, dmg: 13, fire: [1.4, 2.2], range: 470,
      bounty: [150, 220], minWeapon: 2, weight: 3,
      hull: 0x8a3f2f, glow: 0xff9d5c, engine: 0xffb347 }
  ];

  const S = {
    ready: false, active: false,
    nearPlanet: -1, nearStation: false, nearStationIdx: -1, landPrompt: '',
    stats: { speed: 0, thrust: 0 },
    planetMeshes: [],
    stations: [],
    empCD: 0, empPulses: [],
    PIRATE_TYPES: PIRATE_TYPES,

    init(canvas){
      if(this.ready) return;
      this.ready = true;
      this.canvas = canvas;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.FogExp2(0x04060f, 0.00035);
      this.camera = new THREE.PerspectiveCamera(68, 1, 0.5, 12000);
      this.scene.add(new THREE.AmbientLight(0x3d4d70, 1.05));
      const hemi = new THREE.HemisphereLight(0x8fa8ff, 0x1a1030, 0.5);
      this.scene.add(hemi);
      const sun = new THREE.PointLight(0xfff2d8, 1.1, 6000);
      sun.position.set(2000, 1500, -2200);
      this.scene.add(sun);
      // nebula wash: colored lights floating in the play volume brighten dark areas
      // and tint ships/asteroids as you fly through the sector
      const washes = [
        { pos: [-900, 60, -600],  col: 0x6a4fd0, d: 2600 },  // violet arm
        { pos: [900, -80, 900],   col: 0x2f7fd8, d: 2600 },  // blue arm
        { pos: [-200, 120, 1500], col: 0xc04f8a, d: 2400 },  // magenta arm
        { pos: [1400, 200, 1200], col: 0x8a4fd8, d: 2200 }   // near Krell
      ];
      for(const w of washes){
        const l = new THREE.PointLight(w.col, 0.75, w.d, 1.6);
        l.position.set(w.pos[0], w.pos[1], w.pos[2]);
        this.scene.add(l);
      }
      this._buildStars();
      this.buildStations();
      this._buildShip();
      this._buildPlanets();
      this.asteroids = [];
      this.pirates = [];
      this.lasers = [];
      this.oreDrops = [];
      this.parts = [];
      this.fireTimer = 0; this.wing = 0;
      this.pirateTimer = 14;
      // pirate model caches: shared geometries/materials per raider type
      this._pTex = null; this._pCache = {};
      this.shieldDelay = 0;
      this.shake = 0;
      // hover targeting / lock-on state
      this.hover = null;      // screen target under the crosshair
      this.hoverId = null;
      this.lockT = 0;         // seconds held on current target
      this.lockNeed = 3;      // current lock time from scanner level
      this.locked = false;    // true once lockT >= lockNeed
      // quick travel (warp) state
      this.warpTo = null;     // { pos, name, kind, idx } once a target is fully scanned
      this.warpPrompt = '';
      this.warp = null;       // { pos, name, kind, phase, t } while warping
      this.thrustS = 0;       // smoothed thrust 0..1
      this.bank = 0;          // visual bank angle
      // shared geometries/materials (performance: no per-particle allocation)
      this.trailGeo = new THREE.SphereGeometry(1, 6, 5);
      this.laserGeo = new THREE.BoxGeometry(0.5, 0.5, 9);
      this.enemyLaserGeo = new THREE.BoxGeometry(0.5, 0.5, 7);
      this.oreGeo = new THREE.IcosahedronGeometry(2.2, 0);
      this.trailMats = [0x7fdfff, 0x7fdfff, 0xffc46b, 0xff8f5f, 0xaef2ff]
        .map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false }));
      this.trailAcc = 0;
      this._buildNebula();
      this._buildStars();
      this._resize();
    },

    _resize(){
      if(!this.ready) return;
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    },

    // ---------- procedural canvas textures (no image files) ----------
    _mkCanvas(w, h){
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      return cv;
    },
    _hexToRgb(n){
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },

    // Rocky asteroid texture: noise speckle + craters with rim highlights.
    _rockTexture(){
      if(this._rockTex) return this._rockTex;
      const cv = this._mkCanvas(128, 128), c = cv.getContext('2d');
      c.fillStyle = '#788093';
      c.fillRect(0, 0, 128, 128);
      for(let i = 0; i < 1100; i++){
        const g = 0.65 + Math.random() * 0.75;
        c.fillStyle = 'rgba(' + (g * 116 | 0) + ',' + (g * 124 | 0) + ',' + (g * 142 | 0) + ',0.55)';
        c.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
      for(let i = 0; i < 16; i++){
        const x = Math.random() * 128, y = Math.random() * 128, r = 4 + Math.random() * 13;
        const g = c.createRadialGradient(x, y, r * 0.15, x, y, r);
        g.addColorStop(0, 'rgba(26,30,40,0.6)');
        g.addColorStop(0.7, 'rgba(38,42,54,0.35)');
        g.addColorStop(1, 'rgba(130,138,158,0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
        c.strokeStyle = 'rgba(172,182,205,0.4)'; c.lineWidth = 1.3;
        c.beginPath(); c.arc(x, y, r * 0.82, 0.5, 2.3); c.stroke();
      }
      const t = new THREE.CanvasTexture(cv);
      this._rockTex = t;
      return t;
    },

    // Equirect planet surface: terrain blotches, polar caps, craters for hostile worlds.
    _planetTexture(def){
      const W = 512, H = 256;
      const cv = this._mkCanvas(W, H), c = cv.getContext('2d');
      const [r, g0, b] = this._hexToRgb(def.color);
      c.fillStyle = 'rgb(' + r + ',' + g0 + ',' + b + ')';
      c.fillRect(0, 0, W, H);
      const jitter = (f) => Math.max(0, Math.min(255, Math.round(f)));
      // large terrain blotches (lighter + darker)
      for(let i = 0; i < 130; i++){
        const light = Math.random() < 0.5;
        const f = light ? 1.18 + Math.random() * 0.35 : 0.55 + Math.random() * 0.3;
        c.fillStyle = 'rgba(' + jitter(r * f) + ',' + jitter(g0 * f) + ',' + jitter(b * f) + ',0.55)';
        c.beginPath();
        c.ellipse(Math.random() * W, Math.random() * H, 18 + Math.random() * 90, 12 + Math.random() * 55,
          Math.random() * 3, 0, 6.283);
        c.fill();
      }
      // fine noise grain
      for(let i = 0; i < 2600; i++){
        const a = 0.05 + Math.random() * 0.09;
        c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,' + a + ')' : 'rgba(255,255,255,' + a * 0.7 + ')';
        c.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 3, 1 + Math.random() * 2);
      }
      // hostile worlds get craters; lush worlds get darker "sea" patches
      if(def.type === 'hostile'){
        for(let i = 0; i < 26; i++){
          const x = Math.random() * W, y = 20 + Math.random() * (H - 40), cr = 5 + Math.random() * 18;
          const g = c.createRadialGradient(x, y, cr * 0.15, x, y, cr);
          g.addColorStop(0, 'rgba(20,8,26,0.6)');
          g.addColorStop(1, 'rgba(60,30,70,0)');
          c.fillStyle = g;
          c.beginPath(); c.arc(x, y, cr, 0, 6.283); c.fill();
        }
      } else {
        for(let i = 0; i < 16; i++){
          c.fillStyle = 'rgba(' + jitter(r * 0.45) + ',' + jitter(g0 * 0.5) + ',' + jitter(b * 0.65) + ',0.5)';
          c.beginPath();
          c.ellipse(Math.random() * W, Math.random() * H, 25 + Math.random() * 70, 18 + Math.random() * 45,
            Math.random() * 3, 0, 6.283);
          c.fill();
        }
      }
      // polar caps
      for(const yy of [0, H]){
        const g = c.createLinearGradient(0, yy === 0 ? 0 : H, 0, yy === 0 ? H * 0.2 : H * 0.8);
        g.addColorStop(0, 'rgba(240,248,255,0.55)');
        g.addColorStop(1, 'rgba(240,248,255,0)');
        c.fillStyle = g;
        c.fillRect(0, yy === 0 ? 0 : H * 0.8, W, H * 0.2);
      }
      return new THREE.CanvasTexture(cv);
    },

    // Cloud layer texture: soft white swirl bands on transparent canvas.
    _cloudTexture(def){
      const W = 512, H = 256;
      const cv = this._mkCanvas(W, H), c = cv.getContext('2d');
      for(let i = 0; i < 60; i++){
        const x = Math.random() * W, y = 24 + Math.random() * (H - 48);
        const w = 40 + Math.random() * 130, h = 8 + Math.random() * 22;
        const g = c.createRadialGradient(x, y, 1, x, y, w);
        g.addColorStop(0, 'rgba(255,255,255,' + (0.14 + Math.random() * 0.2).toFixed(2) + ')');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.save();
        c.translate(x, y); c.scale(1, h / w); c.translate(-x, -y);
        c.beginPath(); c.arc(x, y, w, 0, 6.283); c.fill();
        c.restore();
      }
      return new THREE.CanvasTexture(cv);
    },

    // Deep-space nebula backdrop: colorful additive clouds + embedded stars,
    // mapped inside a huge inverted sphere.
    _buildNebula(){
      const W = 2048, H = 1024;
      const cv = this._mkCanvas(W, H), c = cv.getContext('2d');
      c.fillStyle = '#02040c';
      c.fillRect(0, 0, W, H);
      const hues = [0.52, 0.58, 0.63, 0.72, 0.78, 0.85, 0.92, 0.33];
      for(let i = 0; i < 30; i++){
        const x = Math.random() * W, y = Math.random() * H;
        const rad = 90 + Math.random() * 380;
        const hue = hues[Math.floor(Math.random() * hues.length)] + (Math.random() - 0.5) * 0.06;
        const col = new THREE.Color().setHSL(hue, 0.75, 0.5);
        const rgb = this._hexToRgb(col.getHex());
        const g = c.createRadialGradient(x, y, 2, x, y, rad);
        g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.05 + Math.random() * 0.1).toFixed(2) + ')');
        g.addColorStop(0.6, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.02 + Math.random() * 0.04).toFixed(2) + ')');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, rad, 0, 6.283); c.fill();
      }
      // dust filaments
      for(let i = 0; i < 220; i++){
        c.strokeStyle = 'rgba(' + (140 + Math.random() * 100 | 0) + ',' + (90 + Math.random() * 90 | 0) + ',255,0.05)';
        c.lineWidth = 1 + Math.random() * 2;
        const x = Math.random() * W, y = Math.random() * H;
        c.beginPath();
        c.moveTo(x, y);
        c.bezierCurveTo(x + (Math.random()-0.5)*300, y + (Math.random()-0.5)*160,
          x + (Math.random()-0.5)*300, y + (Math.random()-0.5)*160,
          x + (Math.random()-0.5)*260, y + (Math.random()-0.5)*140);
        c.stroke();
      }
      // far stars
      for(let i = 0; i < 1400; i++){
        const a = 0.25 + Math.random() * 0.65;
        c.fillStyle = 'rgba(220,235,255,' + a.toFixed(2) + ')';
        const s = Math.random() < 0.9 ? 1 : 2;
        c.fillRect(Math.random() * W, Math.random() * H, s, s);
      }
      const tex = new THREE.CanvasTexture(cv);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(9200, 24, 16),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
      );
      this.nebula = dome;
      this.scene.add(dome);
    },

    _buildStars(){
      const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const c = new THREE.Color();
      for(let i = 0; i < n; i++){
        const r = 5000 + Math.random() * 3000;
        const t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
        pos[i*3]   = r * Math.sin(p) * Math.cos(t);
        pos[i*3+1] = r * Math.cos(p);
        pos[i*3+2] = r * Math.sin(p) * Math.sin(t);
        c.setHSL(0.55 + Math.random() * 0.15, 0.5, 0.55 + Math.random() * 0.35);
        col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.PointsMaterial({ size: 5, vertexColors: true, sizeAttenuation: false, transparent: true, opacity: 0.9 });
      this.scene.add(new THREE.Points(g, m));
    },

    _buildStation(def, idx){
      const grp = new THREE.Group();
      const hullMat = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 0.55, metalness: 0.6 });
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x5ff0ff });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(70, 9, 10, 40), hullMat);
      grp.add(ring);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 60, 12), hullMat);
      hub.rotation.x = Math.PI / 2;
      grp.add(hub);
      for(let i = 0; i < 4; i++){
        const arm = new THREE.Mesh(new THREE.BoxGeometry(70, 4, 6), hullMat);
        arm.rotation.z = i * Math.PI / 2;
        arm.position.set(Math.cos(i * Math.PI / 2) * 40, Math.sin(i * Math.PI / 2) * 40, 0);
        grp.add(arm);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 8), glowMat);
        lamp.position.set(Math.cos(i * Math.PI / 2) * 70, Math.sin(i * Math.PI / 2) * 70, 0);
        grp.add(lamp);
      }
      // enhanced visuals: counter-rotating outer ring, blinking docking strobes
      // and a cyan bay light so stations read as lively hubs from any distance
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(96, 2.4, 8, 48), glowMat);
      grp.add(ring2);
      const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffd25f, transparent: true, opacity: 1 });
      const strobes = [];
      for(let i = 0; i < 6; i++){
        const st = new THREE.Mesh(new THREE.SphereGeometry(1.8, 6, 6), strobeMat.clone());
        st.position.set(Math.cos(i * Math.PI / 3) * 96, Math.sin(i * Math.PI / 3) * 96, 0);
        grp.add(st);
        strobes.push(st);
      }
      const bayLight = new THREE.PointLight(0x5ff0ff, 0.8, 420, 1.6);
      bayLight.position.set(0, 0, 40);
      grp.add(bayLight);
      grp.position.set(def.pos[0], def.pos[1], def.pos[2]);
      this.stations.push({ grp, def, ring2, strobes, idx });
      this.scene.add(grp);
    },

    buildStations(){
      this.stations = [];
      for(let i = 0; i < window.STATIONS.length; i++) this._buildStation(window.STATIONS[i], i);
    },

    // Galaxy map direct travel: teleport to the pad of any station/planet.
    jumpTo(kind, idx){
      let pos, name;
      const prevSys = window.PD.systemIdx;
      if(kind === 'station'){
        const st = this.stations[idx];
        if(!st) return false;
        pos = st.grp.position.clone(); name = st.def.name;
        window.PD.systemIdx = st.def.sys;
      } else {
        const pm = this.planetMeshes[idx], d = window.PLANETS[idx];
        if(!pm || !d) return false;
        pos = pm.position.clone(); name = d.name;
        window.PD.systemIdx = d.sys;
      }
      window.PD.save();
      if(window.PD.systemIdx !== prevSys){
        // Living world: leaving a system rotates that system's vendor stock.
        window.PD.rotateStockForSystem(prevSys);
        this.clearTransient(); this.resetAsteroids(); // Stage B+C: fresh encounters + local mining debris in the new system
      }
      this.syncWorld(); // Stage 1: hide bodies of systems other than the new current one
      const dir = this.ship.position.clone().sub(pos);
      if(dir.length() < 1) dir.set(0, 0, 1);
      dir.normalize();
      const pad = kind === 'station' ? 130 : window.PLANETS[idx].size + 55;
      this.ship.position.copy(pos).addScaledVector(dir, pad);
      // face the body like a fresh arrival (ship fwd is -Z)
      this.ship.quaternion.setFromUnitVectors(V3(0, 0, -1),
        pos.clone().sub(this.ship.position).normalize());
      this.vel.set(0, 0, 0);
      this.warp = null; this.locked = false; this.lockT = 0; this.hover = null; this.hoverId = null;
      this.thrustS = 0.4; this.camPos = null;
      for(let i = 0; i < 10; i++) this._emitTrail(0, 1, 60);
      return true;
    },

    // EMP emitter [F]: expanding non-lethal pulse that disables raiders in range.
    _fireEMP(){
      if(!window.PD.hasModule('emp')) return;
      this.empCD = 8;
      window.GameAudio.emp();
      window.Game.uiToast('⚡ EMP PULSE — raiders disabled');
      const fwd = V3(0, 0, -1).applyQuaternion(this.ship.quaternion);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.09, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0x7ff0ff, transparent: true, opacity: 0.95, depthWrite: false })
      );
      ring.position.copy(this.ship.position);
      ring.quaternion.setFromUnitVectors(V3(0, 1, 0), fwd);
      this.empPulses.push({ mesh: ring, r: 6 });
      this.scene.add(ring);
      let hits = 0;
      for(const e of this.pirates){
        if(e.mesh.position.distanceTo(this.ship.position) < 280 && !e.disabledT){
          e.disabledT = 12;
          e.vel.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(60);
          hits++;
          if(window.Game.onPirateDisable) window.Game.onPirateDisable();
        }
      }
      if(hits) window.Game.uiToast('✦ ' + hits + ' raider' + (hits > 1 ? 's' : '') + ' disabled — non-lethal');
    },

    _buildShip(){
      // physics transform lives on `ship`; visual banking/flame live on `hull`
      this.ship = new THREE.Group();
      this.hull = new THREE.Group();
      this.ship.add(this.hull);
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 6.4, 8),
        new THREE.MeshStandardMaterial({ color: 0xc9d4e0, roughness: 0.35, metalness: 0.75 })
      );
      body.rotation.x = -Math.PI / 2;
      this.hull.add(body);
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.4, metalness: 0.7 });
      const wingGeo = new THREE.BoxGeometry(5.4, 0.4, 2.2);
      const wL = new THREE.Mesh(wingGeo, wingMat); wL.position.set(-3.2, -0.2, 0.6); wL.rotation.z = 0.14;
      const wR = new THREE.Mesh(wingGeo, wingMat); wR.position.set(3.2, -0.2, 0.6); wR.rotation.z = -0.14;
      this.hull.add(wL); this.hull.add(wR);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x5ff0ff });
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 1.6), glowMat);
      fin.position.set(0, 1.1, 1.2);
      this.hull.add(fin);
      // twin engine flames: inner bright core + outer translucent plume
      const flameMat = new THREE.MeshBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0.9, depthWrite: false });
      this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 8), flameMat);
      this.flame.rotation.x = -Math.PI / 2;
      this.flame.position.set(0, 0, 4.6);
      this.hull.add(this.flame);
      const plumeMat = new THREE.MeshBasicMaterial({ color: 0x4fc4ff, transparent: true, opacity: 0.35, depthWrite: false });
      this.plume = new THREE.Mesh(new THREE.ConeGeometry(0.95, 4.6, 8), plumeMat);
      this.plume.rotation.x = -Math.PI / 2;
      this.plume.position.set(0, 0, 5.4);
      this.hull.add(this.plume);
      this.engine = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.2, 8),
        new THREE.MeshBasicMaterial({ color: 0x7fdfff, transparent: true, opacity: 0.85 }));
      this.engine.rotation.x = Math.PI / 2;
      this.engine.position.set(0, 0, 3.6);
      this.hull.add(this.engine);
      // headlight so nearby rocks/pirates stay readable in dark sectors
      this.shipLight = new THREE.PointLight(0xbfe8ff, 0.9, 420, 1.4);
      this.shipLight.position.set(0, 4, 0);
      this.ship.add(this.shipLight);
      this.scene.add(this.ship);
      this.ship.position.set(0, 0, 300);
      this.ship.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
      // Step 1 (Update): player ship rendered at approximately 50% of its design size
      this.ship.scale.setScalar(0.5);
    },

    _buildPlanets(){
      const defs = window.PLANETS;
      for(let i = 0; i < defs.length; i++){
        const d = defs[i];
        const grp = new THREE.Group();
        const s = d.size;
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(s, 36, 24),
          new THREE.MeshStandardMaterial({ map: this._planetTexture(d), roughness: 0.92, metalness: 0.02 })
        );
        sphere.rotation.z = (i % 2 ? 0.2 : -0.15);
        grp.add(sphere);
        // drifting cloud shell
        const clouds = new THREE.Mesh(
          new THREE.SphereGeometry(s * 1.03, 28, 18),
          new THREE.MeshBasicMaterial({ map: this._cloudTexture(d), transparent: true, depthWrite: false })
        );
        grp.add(clouds);
        grp.userData = { index: i, clouds };
        // atmosphere halo (two layers: soft glow + thin bright rim)
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(s * 1.09, 24, 16),
          new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.13, depthWrite: false })
        );
        grp.add(halo);
        const rim = new THREE.Mesh(
          new THREE.SphereGeometry(s * 1.015, 24, 16),
          new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.28, side: THREE.BackSide, depthWrite: false })
        );
        grp.add(rim);
        if(i === 2){ // ringed planet
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(s * 1.35, s * 1.85, 48),
            new THREE.MeshBasicMaterial({ color: 0xb79aff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })
          );
          ring.rotation.x = Math.PI / 2.4;
          grp.add(ring);
          const ring2 = new THREE.Mesh(
            new THREE.RingGeometry(s * 1.9, s * 2.05, 48),
            new THREE.MeshBasicMaterial({ color: 0xd9c8ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
          );
          ring2.rotation.x = Math.PI / 2.4;
          grp.add(ring2);
        }
        grp.position.set(d.x, d.y, d.z);
        this.planetMeshes.push(grp);
        this.scene.add(grp);
      }
    },

    enter(){
      this.active = true;
      if(window.PD.spaceSaved){
        this.ship.position.copy(window.PD.spaceSaved.pos);
        this.ship.quaternion.copy(window.PD.spaceSaved.quat);
        this.vel = window.PD.spaceSaved.vel.clone();
        window.PD.spaceSaved = null;
      } else {
        this.ship.position.set(0, 0, 300);
        this.ship.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
        const fwd0 = V3(0, 0, -1).applyQuaternion(this.ship.quaternion);
        this.vel = V3(0, 0, 0);
        this.vel.copy(fwd0).multiplyScalar(window.PD.maxSpeed() / 3); // default cruising speed
      }
      if(!this.vel) this.vel = V3(0, 0, 0);
      window.PD.resetShipState();
      this.warp = null; this.warpTo = null; this.warpPrompt = '';
      this.thrustS = 1 / 3; this.bank = 0; this.hull.rotation.z = 0;
      // camera swoop: start further back and glide in for a cinematic arrival
      const back = V3(0, 3.2, 11).applyQuaternion(this.ship.quaternion);
      const swoop = V3(0, 3.2, 34).applyQuaternion(this.ship.quaternion);
      this.camPos = this.ship.position.clone().add(swoop);
      // brief exhaust burst on arrival
      for(let i = 0; i < 14; i++) this._emitTrail(0.016, 1, 30);
      window.GameAudio.engine(0.1);
    },

    exit(){ this.active = false; window.GameAudio.engine(0); },

    saveForLanding(){
      window.PD.spaceSaved = {
        pos: this.ship.position.clone(),
        quat: this.ship.quaternion.clone(),
        vel: this.vel.clone().multiplyScalar(0.2)
      };
    },

    // Stage B: leaving a solar system clears its transient combat state
    // (hostile encounters, live lasers, ore drops, particles, EMP pulses) and
    // restarts the pirate spawn cycle so the next system gets fresh encounters.
    clearTransient(){
      for(const p of this.pirates){ this.scene.remove(p.mesh); }
      this.pirates.length = 0;
      for(let i = this.lasers.length - 1; i >= 0; i--){
        const l = this.lasers[i];
        this.scene.remove(l.mesh);
        this.lasers.splice(i, 1);
      }
      for(let i = this.oreDrops.length - 1; i >= 0; i--){
        const o = this.oreDrops[i];
        this.scene.remove(o.mesh);
        this.oreDrops.splice(i, 1);
      }
      for(let i = this.empPulses.length - 1; i >= 0; i--){
        const ep = this.empPulses[i];
        this.scene.remove(ep.mesh);
        this.empPulses.splice(i, 1);
      }
      for(let i = this.parts.length - 1; i >= 0; i--){
        const p = this.parts[i];
        this.scene.remove(p.mesh);
        this.parts.splice(i, 1);
      }
      this.pirateTimer = 14;
    },

    // Stage C: start a hyperspace jump to another system's hub through the
    // existing warp transition (charge -> run -> arrival pads). The arrival
    // handler resolves and persists the destination system.
    hyperspaceToSystem(sysIdx){
      const si = sysIdx | 0;
      const sys = window.SYSTEMS[si];
      if(!sys) return false;
      const st = this.stations[sys.hub];
      if(!st) return false;
      const pos = st.grp.position.clone();
      const dir = this.ship.position.clone().sub(pos);
      if(dir.length() < 1) dir.set(0, 0, 1);
      dir.normalize();
      this.ship.quaternion.setFromUnitVectors(V3(0, 0, -1), dir);
      this.warp = { pos: pos.clone(), name: st.def.name, phase: 'charge', t: 0, kind: 'station', idx: sys.hub };
      this.vel.set(0, 0, 0);
      window.GameAudio.engine(0.2);
      window.Game.uiToast('⇢ WARP SPOOLING — ' + st.def.name);
      return true;
    },

    respawn(){
      this.ship.position.set(0, 40, 300);
      this.ship.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
      const fwdR = V3(0, 0, -1).applyQuaternion(this.ship.quaternion);
      this.vel = V3(0, 0, 0);
      this.vel.copy(fwdR).multiplyScalar(window.PD.maxSpeed() / 3); // default cruising speed
      this.thrustS = 1 / 3;
      for(const p of this.pirates) this.scene.remove(p.mesh);
      this.pirates.length = 0;
      window.PD.systemIdx = 0; // rebuilt at ORION STATION
      window.PD.save();
      this.syncWorld(); // Stage 1: ORION REACH is the only active system after respawn
      this.resetAsteroids(); // Stage 1: respawn asteroid field belongs to ORION REACH
      window.PD.resetShipState();
    },

    // Glowing engine exhaust particles streaming behind the ship.
    // Shared geometry + pooled materials keep allocation out of the hot path.
    _emitTrail(dt, thrustLevel, spd){
      const rate = thrustLevel > 0 ? 60 : 10;
      this.trailAcc += rate * dt;
      const back = V3(0, 0, 4.4).applyQuaternion(this.ship.quaternion);
      while(this.trailAcc >= 1){
        this.trailAcc--;
        if(this.parts.length > 140) return;
        const jitter = V3((Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 1.3)
          .applyQuaternion(this.ship.quaternion);
        const hot = thrustLevel > 0 && Math.random() < 0.3;
        const m = new THREE.Mesh(this.trailGeo,
          this.trailMats[(Math.random() * this.trailMats.length) | 0]);
        m.scale.setScalar(0.3 + Math.random() * 0.35 + thrustLevel * 0.25);
        m.position.copy(this.ship.position).add(back).add(jitter);
        const drift = back.clone().multiplyScalar(-1).addScaledVector(this.vel, -0.25)
          .add(V3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4));
        const life = 0.3 + Math.random() * 0.45;
        this.parts.push({ mesh: m, life, maxLife: life, vel: drift, spin: 0, shrink: true, glow: true });
        this.scene.add(m);
      }
    },

    // Warp speed lines streaking past during a quick-travel jump.
    _emitWarpStreaks(){
      if(this.parts.length > 150) return;
      const fwd = V3(0, 0, -1).applyQuaternion(this.ship.quaternion);
      const side = V3(1, 0, 0).applyQuaternion(this.ship.quaternion);
      const upv = V3(0, 1, 0).applyQuaternion(this.ship.quaternion);
      const m = new THREE.Mesh(this.laserGeo,
        new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.55, depthWrite: false }));
      const off = (Math.random() - 0.5) * 90;
      const offY = (Math.random() - 0.5) * 50;
      m.position.copy(this.ship.position).addScaledVector(fwd, 140 + Math.random() * 160)
        .addScaledVector(side, off).addScaledVector(upv, offY);
      m.quaternion.setFromUnitVectors(V3(0, 0, -1), fwd);
      m.scale.set(1, 1, 5 + Math.random() * 8);
      this.parts.push({ mesh: m, life: 0.5, maxLife: 0.5, vel: fwd.clone().multiplyScalar(-420), spin: 0, shrink: false });
      this.scene.add(m);
    },

    // Crosshair hover detection + lock-on timing (scanner upgrade speeds it up).
    _updateLock(dt){
      const tg = this._targets = this.getScreenTargets();
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      let hover = null, hd = 1e9;
      for(const t of tg){
        if(t.dist > 3200) continue;
        const sx = t.x * window.innerWidth, sy = t.y * window.innerHeight;
        const r = Math.max(16, (t.size || 12) * 1.15);
        const d = Math.hypot(sx - cx, sy - cy);
        if(d < r + 6 && d < hd){ hd = d; hover = t; }
      }
      if(hover){
        if(this.hoverId !== hover.id){ this.hoverId = hover.id; this.lockT = 0; this.locked = false; }
        this.hover = hover;
        this.lockNeed = window.PD.scannerLockTime();
        if(!this.locked){
          this.lockT += dt;
          if(this.lockT >= this.lockNeed){
            this.locked = true;
            window.GameAudio.lock();
          }
        }
        // fully scanned planet/station => quick travel target
        if(this.locked && (hover.type === 'planet' || hover.type === 'station')){
          let idx, base, pad;
          if(hover.type === 'planet'){
            idx = parseInt(hover.id.slice(2), 10);
            base = this.planetMeshes[idx].position;
            pad = window.PLANETS[idx].size + 55;
          } else {
            idx = parseInt(hover.id.slice(1), 10);
            base = this.stations[idx].grp.position;
            pad = 130;
          }
          const dirFrom = this.ship.position.clone().sub(base).normalize();
          this.warpTo = { pos: base.clone().addScaledVector(dirFrom, pad), name: hover.name,
            kind: hover.type, idx };
          this.warpPrompt = 'Press <b>Q</b> to quick-travel to <b>' + hover.name + '</b>';
        } else {
          this.warpTo = null;
          this.warpPrompt = '';
        }
      } else {
        this.hover = null; this.hoverId = null; this.lockT = 0; this.locked = false;
        this.warpTo = null; this.warpPrompt = '';
      }
    },

    _spawnExplosion(pos, big){
      const n = big ? 26 : 14;
      for(let i = 0; i < n; i++){
        const m = new THREE.Mesh(
          new THREE.TetrahedronGeometry(0.6 + Math.random() * (big ? 2 : 1)),
          new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xffb84d : 0xff5f2a, transparent: true })
        );
        m.position.copy(pos);
        this.parts.push({
          mesh: m, life: 0.9 + Math.random() * 0.8,
          vel: V3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60),
          spin: (Math.random() - 0.5) * 6
        });
        this.scene.add(m);
      }
      const flash = new THREE.Mesh(new THREE.SphereGeometry(big ? 10 : 5, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 }));
      flash.position.copy(pos);
      this.parts.push({ mesh: flash, life: 0.35, vel: V3(0,0,0), flash: true, big });
      this.scene.add(flash);
    },

    // Direction of the aim ray: from the camera through the crosshair (screen center),
    // so lasers converge on whatever the player is pointing at.
    _aimDir(){
      const v = V3(0, 0, 0.5).unproject(this.camera);
      return v.sub(this.camera.position).normalize();
    },

    _fire(){
      const dmg = window.PD.laserDmg();
      const dir = this._aimDir();
      const right = V3(1, 0, 0).applyQuaternion(this.ship.quaternion);
      this.wing = 1 - this.wing;
      const mesh = new THREE.Mesh(this.laserGeo,
        new THREE.MeshBasicMaterial({ color: this.wing ? 0x7ff7ff : 0xaef2ff }));
      mesh.position.copy(this.ship.position).addScaledVector(right, this.wing ? -3.4 : 3.4).addScaledVector(dir, 2);
      mesh.quaternion.setFromUnitVectors(V3(0, 0, -1), dir);
      this.lasers.push({ mesh, vel: dir.clone().multiplyScalar(700), dmg, life: 1.6, mine: true });
      this.scene.add(mesh);
      window.GameAudio.laser();
    },

    _enemyFire(p, dmg){
      const toP = this.ship.position.clone().sub(p.mesh.position).normalize();
      const mesh = new THREE.Mesh(this.enemyLaserGeo,
        new THREE.MeshBasicMaterial({ color: p.type.glow }));
      mesh.position.copy(p.mesh.position).addScaledVector(toP, 4);
      mesh.quaternion.setFromUnitVectors(V3(0, 0, -1), toP);
      this.lasers.push({ mesh, vel: toP.multiplyScalar(520), dmg: dmg || 7, life: 1.8, mine: false });
      this.scene.add(mesh);
      window.GameAudio.tone ? window.GameAudio.laser() : 0;
    },

    // Procedural hull plating texture (panel seams + rivets + scuffs). Shared by
    // every pirate; per-type colour comes from the material tint.
    _panelTexture(){
      if(this._pTex) return this._pTex;
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = 'rgba(0,0,0,0.32)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, 21); g.lineTo(64, 21);
      g.moveTo(0, 43); g.lineTo(64, 43);
      g.moveTo(21, 0); g.lineTo(21, 21);
      g.moveTo(43, 21); g.lineTo(43, 43);
      g.moveTo(32, 43); g.lineTo(32, 64);
      g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.38)';
      for(let i = 0; i < 12; i++) g.fillRect((i * 13) % 60 + 2, (i * 29) % 60 + 2, 2, 2);
      g.fillStyle = 'rgba(0,0,0,0.10)';
      g.fillRect(8, 8, 12, 4);
      g.fillRect(46, 50, 10, 5);
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter;
      this._pTex = tex;
      return tex;
    },

    // Builds one raider hull. Geometries and materials are cached per type and
    // shared between instances; the hull always faces nose +Z so `lookAt` gives
    // a correct profile from any angle.
    _buildPirateModel(def){
      const cache = this._pCache[def.key] ||
        (this._pCache[def.key] = {
          hullMat: new THREE.MeshStandardMaterial({
            color: def.hull, roughness: 0.55, metalness: 0.65, map: this._panelTexture() }),
          glowMat: new THREE.MeshBasicMaterial({ color: def.glow }),
          cone: new THREE.ConeGeometry(1.7, 5.6, 6),
          slim: new THREE.ConeGeometry(1.0, 7.4, 5),
          oct: new THREE.CylinderGeometry(2.0, 2.0, 4.4, 8),
          fat: new THREE.DodecahedronGeometry(2.5, 0),
          wing: new THREE.BoxGeometry(6.4, 0.45, 1.9),
          fin: new THREE.BoxGeometry(3.2, 0.3, 1.2),
          pod: new THREE.CylinderGeometry(0.55, 0.55, 3.6, 6),
          plate: new THREE.BoxGeometry(3.1, 0.7, 2.6),
          turret: new THREE.SphereGeometry(0.9, 7, 6),
          orb: new THREE.SphereGeometry(0.6, 6, 5)
        });
      const grp = new THREE.Group();
      const hullMeshes = [];
      const addHull = geo => {
        const m = new THREE.Mesh(geo, cache.hullMat);
        grp.add(m); hullMeshes.push(m); return m;
      };
      const addGlow = (x, y, z) => {
        const m = new THREE.Mesh(cache.orb, cache.glowMat);
        m.position.set(x, y, z);
        grp.add(m);
        return m;
      };
      if(def.key === 'stalker'){
        // needle interceptor: long slim hull, forward canards, single tail light
        const body = addHull(cache.slim); body.rotation.x = Math.PI / 2;
        const canard = addHull(cache.fin); canard.position.z = 2.3;
        const fin = addHull(cache.fin);
        fin.position.z = -2.7; fin.rotation.z = Math.PI / 2; fin.scale.set(0.7, 1.1, 1);
        addGlow(0, 0, -2.9);
      } else if(def.key === 'warlord'){
        // heavy brawler: fat core, armoured shoulders, dorsal turret, twin thusters
        const core = addHull(cache.fat); core.rotation.x = Math.PI / 2;
        const nose = addHull(cache.cone);
        nose.rotation.x = Math.PI / 2; nose.scale.set(0.8, 0.9, 0.8); nose.position.z = 3.2;
        const pl = addHull(cache.plate); pl.position.set(-2.2, 0.8, 0.6); pl.rotation.z = 0.3;
        const pr = addHull(cache.plate); pr.position.set(2.2, 0.8, 0.6); pr.rotation.z = -0.3;
        const tur = addHull(cache.turret); tur.position.set(0, 1.6, -0.4);
        addGlow(0, 0, -2.5);
        addGlow(-1.9, -1.2, 2.0);
        addGlow(1.9, -1.2, 2.0);
      } else if(def.key === 'marauder'){
        // gunship: octagonal core, side engine pods, nose cone
        const core = addHull(cache.oct); core.rotation.x = Math.PI / 2;
        const nose = addHull(cache.cone);
        nose.rotation.x = Math.PI / 2; nose.scale.set(0.7, 0.8, 0.7); nose.position.z = 3.4;
        const podL = addHull(cache.pod); podL.rotation.x = Math.PI / 2; podL.position.set(-2.5, 0, 0.4);
        const podR = addHull(cache.pod); podR.rotation.x = Math.PI / 2; podR.position.set(2.5, 0, 0.4);
        addGlow(0, 0, -2.7);
        addGlow(-2.5, 0, 2.2);
        addGlow(2.5, 0, 2.2);
      } else {
        // baseline raider: swept delta wing + nose sensor
        const body = addHull(cache.cone); body.rotation.x = Math.PI / 2;
        const w = addHull(cache.wing); w.rotation.z = 0.12;
        addGlow(0, 0, -2.3);
        addGlow(0, 0, 3.3);
      }
      grp.scale.setScalar(def.scale);
      return { grp, hullMeshes };
    },

    // Weighted pick; heavier hulls stay rare and are gated behind weapon level
    // so early-game encounters remain survivable.
    _pickPirateType(){
      const wLvl = window.PD.up.weapon;
      const pool = PIRATE_TYPES.filter(t => t.minWeapon <= wLvl);
      let total = 0;
      for(const t of pool) total += t.weight;
      let roll = Math.random() * total;
      for(const t of pool){
        roll -= t.weight;
        if(roll <= 0) return t;
      }
      return pool[pool.length - 1];
    },

    _spawnPirate(typeKey){
      if(this.pirates.length >= 4) return;
      const type = (typeKey && PIRATE_TYPES.find(t => t.key === typeKey)) || this._pickPirateType();
      const grp = this._buildPirateModel(type).grp;
      // per-instance blink + engine lights (independent animation per raider)
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xff2d4d, transparent: true, opacity: 0.95, depthWrite: false }));
      beacon.position.set(0, 1.4, 1.8);
      grp.add(beacon);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6),
        new THREE.MeshBasicMaterial({ color: type.glow, transparent: true, opacity: 0.28, depthWrite: false }));
      halo.position.set(0, 0, 2.4);
      grp.add(halo);
      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 5),
        new THREE.MeshBasicMaterial({ color: type.engine, transparent: true, opacity: 0.5, depthWrite: false }));
      tail.position.set(0, 0, 3.4);
      grp.add(tail);
      const plight = new THREE.PointLight(type.glow, 0.7, 260, 1.6);
      plight.position.set(0, 0, 3);
      grp.add(plight);
      const dir = V3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize();
      grp.position.copy(this.ship.position).addScaledVector(dir, 420);
      const p = { mesh: grp, type,
        hp: type.hp[0] + Math.random() * (type.hp[1] - type.hp[0]),
        fireT: 1 + Math.random(), vel: V3(0,0,0), bank: 0, seed: Math.random() * 9,
        beacon, halo, tail, plight };
      grp.lookAt(this.ship.position);
      this.pirates.push(p);
      this.scene.add(grp);
      window.GameAudio.alarm();
      window.Game.uiToast('⚠ ' + type.name + ' DETECTED');
      return p;
    },

    // Single destruction path so bounty, hooks and cleanup never diverge.
    _killPirate(e){
      this._spawnExplosion(e.mesh.position, true);
      window.GameAudio.bigBoom();
      const PD = window.PD;
      const bounty = e.type.bounty[0] +
        Math.floor(Math.random() * (e.type.bounty[1] - e.type.bounty[0] + 1));
      PD.credits += bounty;
      window.Game.uiToast('+' + bounty + ' CR bounty · ' + e.type.name);
      PD.save();
      if(window.Game.onPirateKill) window.Game.onPirateKill(true);
      this.scene.remove(e.mesh);
      const idx = this.pirates.indexOf(e);
      if(idx >= 0) this.pirates.splice(idx, 1);
    },

    _hit(pos){
      window.GameAudio.laserHit();
      for(let i = 0; i < 5; i++){
        const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.4),
          new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true }));
        m.position.copy(pos);
        this.parts.push({ mesh: m, life: 0.4, vel: V3((Math.random()-0.5)*40, (Math.random()-0.5)*40, (Math.random()-0.5)*40), spin: 5 });
        this.scene.add(m);
      }
    },

    // swept sphere vs sphere test
    _segSphereHit(p0, p1, center, radius){
      const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
      const fx = p0.x - center.x, fy = p0.y - center.y, fz = p0.z - center.z;
      const a = dx*dx + dy*dy + dz*dz;
      if(a < 1e-12){
        // no movement; point test
        return (fx*fx + fy*fy + fz*fz) <= radius*radius;
      }
      const b = 2 * (fx*dx + fy*dy + fz*dz);
      const c = (fx*fx + fy*fy + fz*fz) - radius*radius;
      let disc = b*b - 4*a*c;
      if(disc < 0) return false;
      disc = Math.sqrt(disc);
      const t1 = (-b - disc) / (2*a);
      const t2 = (-b + disc) / (2*a);
      if(t1 >= 0 && t1 <= 1) return true;
      if(t2 >= 0 && t2 <= 1) return true;
      if(t1 < 0 && t2 > 1) return true;
      return false;
    },

    // asteroid collisions: destroy asteroid + ore drop + 70 damage, once per asteroid
    _handleAsteroidCollisions(prevPos){
      const shipR = 12;
      const curr = this.ship.position;
      for(let a = this.asteroids.length - 1; a >= 0; a--){
        const ast = this.asteroids[a];
        const center = ast.mesh.position;
        const rad = ast.r + shipR;
        if(this._segSphereHit(prevPos, curr, center, rad)){
          // destroy asteroid + ore drops (reuse existing destruction logic)
          this._spawnExplosion(ast.mesh.position, false);
          window.GameAudio.boom();
          this.scene.remove(ast.mesh);
          const drops = 2 + Math.floor(Math.random() * 2);
          for(let d = 0; d < drops; d++){
            const ore = new THREE.Mesh(this.oreGeo,
              new THREE.MeshBasicMaterial({ color: 0x9ad2ff }));
            ore.position.copy(ast.mesh.position).add(V3((Math.random()-0.5)*6, (Math.random()-0.5)*6, (Math.random()-0.5)*6));
            this.oreDrops.push({ mesh: ore, vel: V3((Math.random()-0.5)*12, (Math.random()-0.5)*12, (Math.random()-0.5)*12), life: 30 });
            this.scene.add(ore);
          }
          this.asteroids.splice(a, 1);
          // damage ship 70 (shields first, then hull) via existing PD.dmg
          const PD = window.PD;
          PD.dmg(70);
          this.shieldDelay = 5;
          this.shake = 0.35;
          window.GameAudio.hurt();
        }
      }
    },

    // planet collisions: keep ship outside solid surface (smooth push-out)
    _collidePlayer(){
      const shipR = 12;
      for(const pm of this.planetMeshes){
        const idx = (pm.userData && pm.userData.index != null) ? pm.userData.index : this.planetMeshes.indexOf(pm);
        const def = window.PLANETS[idx];
        if(!def) continue;
        const center = pm.position;
        const r = def.size + shipR;
        const toShip = this.ship.position.clone().sub(center);
        const dist = toShip.length();
        if(dist < r && dist > 0.001){
          const push = r - dist;
          this.ship.position.add(toShip.clone().normalize().multiplyScalar(push));
          // cancel inward radial velocity so the ship slides along the surface
          const n = toShip.clone().normalize();
          const radial = this.vel.dot(n);
          if(radial < 0) this.vel.addScaledVector(n, -radial);
        } else if(dist <= 0.001){
          // degenerate: push along forward
          const fwd = V3(0, 0, -1).applyQuaternion(this.ship.quaternion);
          this.ship.position.add(fwd.clone().multiplyScalar(r));
        }
      }
      // asteroid collisions
      if(this._shipPrevPos) this._handleAsteroidCollisions(this._shipPrevPos);
    },

    // Stage 1: rebuild the ambient asteroid field around the current system's hub
    // so mining debris belongs to the active solar system.
    resetAsteroids(){
      this.asteroids = [];
      this.buildAsteroids();
    },

    // Stage 1: solar-system isolation — only bodies belonging to the player's
    // current system exist in the active world. Non-current planets/stations are
    // physically removed from the scene, so they cannot be seen, flown into,
    // targeted or collided with. Local gameplay inside the current system is
    // untouched.
    syncWorld(){
      const cur = window.PD.systemIdx | 0;
      const sts = this.stations || [];
      for(let i = 0; i < sts.length; i++){
        const st = sts[i];
        if(!st) continue;
        const local = window.PD.systemOf('station', i) === cur;
        if(local && st.grp.parent !== this.scene){
          this.scene.add(st.grp);
        } else if(!local && st.grp.parent === this.scene){
          this.scene.remove(st.grp);
        }
        st.grp.visible = local;
      }
      const pms = this.planetMeshes || [];
      for(let i = 0; i < pms.length; i++){
        const pm = pms[i];
        if(!pm) continue;
        const local = window.PD.systemOf('planet', i) === cur;
        if(local && pm.parent !== this.scene){
          this.scene.add(pm);
        } else if(!local && pm.parent === this.scene){
          this.scene.remove(pm);
        }
        pm.visible = local;
      }
    },

    update(dt){
      if(!this.active) return;
      const G = window.Game, PD = window.PD;
      const inp = G.input;
      const t = performance.now() / 1000;

      // ---- quick travel: launch on Q when a target is fully scanned & no pirates near ----
      if(this.warp && this.warp.phase === 'charge'){
        this.warp.t += dt;
        this.shake = 0.3;
        if(this.warp.t >= 0.9){
          this.warp.phase = 'run';
          window.GameAudio.warp();
        }
      }
      if(!this.warp && inp.pressed('KeyQ') && this.locked && this.warpTo){
        let blocked = false;
        for(const e of this.pirates){
          if(e.mesh.position.distanceTo(this.ship.position) < 700){ blocked = true; break; }
        }
        if(blocked){
          window.Game.uiToast('✖ WARP BLOCKED — HOSTILES IN RANGE');
          window.GameAudio.alarm();
        } else {
          const wt = this.warpTo;
          const dir = wt.pos.clone().sub(this.ship.position).normalize();
          // orient the ship at the destination, then spool up
          this.ship.quaternion.setFromUnitVectors(V3(0, 0, -1), dir);
          this.warp = { pos: wt.pos.clone(), name: wt.name, phase: 'charge', t: 0,
            kind: wt.kind, idx: wt.idx };
          this.vel.set(0, 0, 0);
          window.GameAudio.engine(0.2);
          window.Game.uiToast('⇢ WARP SPOOLING — ' + wt.name);
        }
      }

      // steering: keyboard-only during spaceflight. W/S pitch the nose up/down,
      // A/D yaw left/right — orientation only, thrust is never touched here.
      // No mouse influence: pointer position no longer rotates the ship (the old
      // virtual-stick feel let a stray mouse offset spin the vessel continuously).
      // No roll input: yaw + pitch only, with auto-level to prevent upside-down drift.
      const keyYaw = (inp.keys.has('KeyD') ? 1 : 0) - (inp.keys.has('KeyA') ? 1 : 0);
      const keyPitch = (inp.keys.has('KeyS') ? 1 : 0) - (inp.keys.has('KeyW') ? 1 : 0);
      const yawRate = -keyYaw * 1.15;
      const pitchRate = keyPitch * 0.9;
      if(!this.warp){
        this.ship.rotateY(yawRate * dt);
        this.ship.rotateX(pitchRate * dt);
      }

      // auto-level: damp any roll so the ship never flies inverted / flips controls
      const fwdLvl = V3(0, 0, -1).applyQuaternion(this.ship.quaternion);
      if(Math.abs(fwdLvl.y) < 0.96){
        const up = V3(0, 1, 0).applyQuaternion(this.ship.quaternion);
        const des = V3(0, 1, 0).addScaledVector(fwdLvl, -fwdLvl.y).normalize();
        const rollErr = Math.atan2(
          new THREE.Vector3().crossVectors(up, des).dot(fwdLvl),
          up.dot(des)
        );
        if(Math.abs(rollErr) > 0.001){
          this.ship.rotateZ(-Math.max(-1.4, Math.min(1.4, rollErr)) * Math.min(1, 4 * dt));
        }
      }

      // visual banking: the hull leans into turns (physics heading unaffected)
      const bankTarget = this.warp ? 0 : Math.max(-0.5, Math.min(0.5, -yawRate * 0.3));
      this.bank += (bankTarget - this.bank) * Math.min(1, 7 * dt);
      this.hull.rotation.z = this.bank;
      this.hull.rotation.x = this.warp ? 0 : Math.max(-0.25, Math.min(0.25, pitchRate * 0.12));

      // engine thrust level (0..1): persistent setting. B holds to increase the
      // thrust level; N holds to decrease it; releasing a key holds the current
      // level. The thrust level drives forward acceleration; velocity/momentum
      // and drag are handled by the existing flight physics.
      const fwd = V3(0, 0, -1).applyQuaternion(this.ship.quaternion);
      const holdB = inp.keys.has('KeyB');
      const holdN = inp.keys.has('KeyN');
      if(holdB){
        this.thrustS = Math.min(1, this.thrustS + 0.25 * dt);
      } else if(holdN){
        this.thrustS = Math.max(0, this.thrustS - 0.25 * dt);
      }
      if(this.thrustS < 0.003) this.thrustS = 0;
      if(!this.warp){
        if(this.thrustS > 0){
          this.vel.addScaledVector(fwd, PD.thrust() * this.thrustS * dt);
        }
        // existing physics: drag (inertia / momentum)
        this.vel.multiplyScalar(Math.max(0, 1 - 0.25 * dt));
        const spd2 = this.vel.length(), maxS2 = PD.maxSpeed();
        if(spd2 > maxS2) this.vel.multiplyScalar(maxS2 / spd2);
      }

      // warp travel: accelerate hard along the corridor, brake in sync with
      // remaining distance (v²/2a), crawl the last meters to the pad
      const wantThrust = this.thrustS;
      let thrustLevel = wantThrust;
      if(this.warp){
        if(this.warp.phase === 'run'){
          this._emitWarpStreaks();
          const toT = this.warp.pos.clone().sub(this.ship.position);
          const distT = toT.length();
          toT.normalize();
          const spd3 = this.vel.length();
          const stopDist = (spd3 * spd3) / (2 * 900);
          if(distT < 45){ // reached the arrival pad
            // new spaceflight segment begins -> ship starts at the default cruising speed
            const arrFwd = V3(0, 0, -1).applyQuaternion(this.ship.quaternion);
            this.vel = V3(0, 0, 0);
            this.vel.copy(arrFwd).multiplyScalar(window.PD.maxSpeed() / 3); // default cruising speed
            this.thrustS = 1 / 3;
            this.ship.position.copy(this.warp.pos);
            const prevSys = window.PD.systemIdx;
            window.PD.systemIdx = window.PD.systemOf(this.warp.kind, this.warp.idx);
            window.PD.save();
            if(window.PD.systemIdx !== prevSys){ this.clearTransient(); this.resetAsteroids(); } // Stage B+C: fresh encounters + local mining debris in the new system
            this.syncWorld(); // Stage 1: hide bodies of systems other than the new current one
            window.Game.uiToast('⇢ ARRIVED — ' + this.warp.name);
            window.GameAudio.pickup();
            this.warp = null;
            this.shake = 0.15;
          } else if(distT < stopDist + 40){
            this.vel.addScaledVector(toT, -900 * dt * 1.4); // brake burn
          } else {
            this.vel.addScaledVector(toT, 950 * dt);
            if(this.vel.length() > 1500) this.vel.setLength(1500);
          }
          // cap crawl speed near the pad so we never overshoot
          if(this.warp && distT < 220 && this.vel.length() > 150) this.vel.setLength(150);
          if(this.warp) this.ship.position.addScaledVector(this.vel, dt);
          thrustLevel = 1;
        }
      }

      const spd = this.vel.length(), maxS = PD.maxSpeed();
      if(spd > maxS && !this.warp) this.vel.multiplyScalar(maxS / spd);
      this._shipPrevPos = this.ship.position.clone();
      if(!this.warp) this.ship.position.addScaledVector(this.vel, dt);
      // physical collisions (player ship)
      if(!this.warp) this._collidePlayer();
      this.stats.speed = spd;
      this.stats.thrust = this.thrustS;
      window.GameAudio.engine(this.warp ? 1 : 0.12 + this.thrustS * 0.85 * (spd / maxS));
      // engine flame: spools smoothly with thrust, flickers subtly at full burn
      const flameS = 0.25 + this.thrustS * 1.1 + (this.warp ? 1.2 : 0);
      this.engine.scale.setScalar(0.6 + flameS * (0.7 + Math.random() * 0.12));
      this.flame.scale.set(1 + this.thrustS * 0.4, 1 + this.thrustS * 0.4, flameS * (0.9 + Math.random() * 0.18));
      this.flame.material.opacity = 0.35 + this.thrustS * 0.6;
      this.plume.scale.set(1, 1, 0.3 + flameS * 0.55);
      this.plume.material.opacity = 0.12 + this.thrustS * 0.28;
      this.shipLight.intensity = 0.7 + this.thrustS * 0.5 + (this.warp ? 0.6 : 0);
      if(spd > 30) this.ship.position.y += Math.sin(t * 30) * 0.01;
      this._emitTrail(dt, thrustLevel, spd);

      // hover targeting & lock-on (scanner-gated) + quick-travel target
      this._updateLock(dt);

      // fire
      this.fireTimer -= dt;
      if(!this.warp && (inp.mouseDown || inp.keys.has('Space'))){
        if(this.fireTimer <= 0){
          this.fireTimer = PD.fireDelay();
          this._fire();
        }
      }

      // lasers
      for(let i = this.lasers.length - 1; i >= 0; i--){
        const l = this.lasers[i];
        l.life -= dt;
        l.mesh.position.addScaledVector(l.vel, dt);
        if(l.life <= 0){ this.scene.remove(l.mesh); this.lasers.splice(i, 1); continue; }
        // planets block lasers
        let planetHit = false;
        for(const pm of this.planetMeshes){
          const idx = (pm.userData && pm.userData.index != null) ? pm.userData.index : this.planetMeshes.indexOf(pm);
          const def = window.PLANETS[idx];
          if(!def) continue;
          if(l.mesh.position.distanceTo(pm.position) < def.size){
            planetHit = true; break;
          }
        }
        if(planetHit){ this.scene.remove(l.mesh); this.lasers.splice(i, 1); continue; }
        if(l.mine){
          let hit = false;
          for(let a = this.asteroids.length - 1; a >= 0; a--){
            const ast = this.asteroids[a];
            if(l.mesh.position.distanceTo(ast.mesh.position) < ast.r + 2){
              ast.hp -= l.dmg;
              this._hit(l.mesh.position);
              if(ast.hp <= 0){
                this._spawnExplosion(ast.mesh.position, false);
                window.GameAudio.boom();
                this.scene.remove(ast.mesh);
                this.asteroids.splice(a, 1);
                const drops = 2 + Math.floor(Math.random() * 2);
                for(let d = 0; d < drops; d++){
                  const ore = new THREE.Mesh(this.oreGeo,
                    new THREE.MeshBasicMaterial({ color: 0x9ad2ff }));
                  ore.position.copy(ast.mesh.position).add(V3((Math.random()-0.5)*6, (Math.random()-0.5)*6, (Math.random()-0.5)*6));
                  this.oreDrops.push({ mesh: ore, vel: V3((Math.random()-0.5)*12, (Math.random()-0.5)*12, (Math.random()-0.5)*12), life: 30 });
                  this.scene.add(ore);
                }
              }
              hit = true;
              break;
            }
          }
          if(!hit){
            for(let p = this.pirates.length - 1; p >= 0; p--){
              const e = this.pirates[p];
              if(l.mesh.position.distanceTo(e.mesh.position) < 6){
                e.hp -= l.dmg;
                this._hit(l.mesh.position);
                if(e.hp <= 0) this._killPirate(e);
                hit = true;
                break;
              }
            }
          }
          if(hit){ this.scene.remove(l.mesh); this.lasers.splice(i, 1); }
        } else {
          if(l.mesh.position.distanceTo(this.ship.position) < 4.5){
            PD.dmg(l.dmg);
            this.shieldDelay = 5;
            this.shake = 0.25;
            window.GameAudio.hurt();
            this.scene.remove(l.mesh);
            this.lasers.splice(i, 1);
          }
        }
      }

      // ore pickups
      for(let i = this.oreDrops.length - 1; i >= 0; i--){
        const o = this.oreDrops[i];
        o.life -= dt;
        o.mesh.position.addScaledVector(o.vel, dt);
        o.vel.multiplyScalar(1 - 0.5 * dt);
        o.mesh.rotation.x += dt; o.mesh.rotation.y += dt * 1.4;
        if(o.life <= 0){ this.scene.remove(o.mesh); this.oreDrops.splice(i, 1); continue; }
        if(o.mesh.position.distanceTo(this.ship.position) < PD.scoopRadius()){
          const got = PD.addItem('ore', 1);
          if(got > 0){
            window.GameAudio.pickup();
            window.Game.uiToast('+1 Iron Ore');
          } else {
            window.Game.uiToast('CARGO FULL');
          }
          this.scene.remove(o.mesh);
          this.oreDrops.splice(i, 1);
        }
      }

      // pirate AI
      this.pirateTimer -= dt;
      if(this.pirateTimer <= 0){
        this.pirateTimer = 30 + Math.random() * 20; // Step 3E: ~2-3 min pacing
        if(Math.random() < 0.65) this._spawnPirate();
      }
      for(const e of this.pirates){
        // disabled raiders (EMP) drift away and can't fire — non-lethal takedown
        if(e.disabledT > 0){
          e.disabledT -= dt;
          const away = e.mesh.position.clone().sub(this.ship.position).normalize();
          e.mesh.position.addScaledVector(away, 42 * dt);
          // keep disabled raider clear of planets
          for(const pm of this.planetMeshes){
            const idx = (pm.userData && pm.userData.index != null) ? pm.userData.index : this.planetMeshes.indexOf(pm);
            const def = window.PLANETS[idx];
            if(!def) continue;
            const center = pm.position;
            const r = def.size + 8;
            const toP = e.mesh.position.clone().sub(center);
            const d = toP.length();
            if(d < r && d > 0.001){
              e.mesh.position.add(toP.clone().normalize().multiplyScalar(r - d));
            }
          }
          e.mesh.lookAt(this.ship.position);
          const dblink = 0.35 + 0.65 * Math.abs(Math.sin(t * 18));
          if(e.beacon) e.beacon.material.opacity = dblink;
          if(e.halo) e.halo.material.opacity = 0.05 + dblink * 0.15;
          if(e.tail) e.tail.material.opacity = 0.12 + 0.1 * Math.abs(Math.sin(t * 12));
          if(e.plight) e.plight.intensity = 0.2 + dblink * 0.4;
          continue;
        }
        const toShip = this.ship.position.clone().sub(e.mesh.position);
        const dist = toShip.length();
        toShip.normalize();
        const desired = toShip.multiplyScalar(Math.max(0, dist - 60) * 1.1);
        e.vel.lerp(desired.clampLength(0, e.type.speed), 0.03);
        e.mesh.position.addScaledVector(e.vel, dt);
        // planet collision: keep pirate outside solid surface
        for(const pm of this.planetMeshes){
          const idx = (pm.userData && pm.userData.index != null) ? pm.userData.index : this.planetMeshes.indexOf(pm);
          const def = window.PLANETS[idx];
          if(!def) continue;
          const center = pm.position;
          const r = def.size + 8;
          const toP = e.mesh.position.clone().sub(center);
          const d = toP.length();
          if(d < r && d > 0.001){
            const push = r - d;
            e.mesh.position.add(toP.clone().normalize().multiplyScalar(push));
            const n = toP.clone().normalize();
            const radial = e.vel.dot(n);
            if(radial < 0) e.vel.addScaledVector(n, -radial);
          }
        }
        e.mesh.lookAt(this.ship.position);
        // dynamic bank: each hull sways in flight, stalkers lean harder
        const sway = e.type.key === 'stalker' ? 0.22 : e.type.key === 'warlord' ? 0.05 : 0.1;
        e.bank += ((Math.sin(t * 1.2 + e.seed) * sway) - e.bank) * 0.05;
        e.mesh.rotation.z = e.bank;
        // beacon blink + engine pulse keep them visible in dark nebula sectors
        const blink = 0.55 + 0.45 * Math.sin(t * 9 + e.hp);
        if(e.beacon) e.beacon.material.opacity = blink;
        if(e.halo) e.halo.material.opacity = 0.14 + blink * 0.22;
        if(e.tail) e.tail.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 7 + e.seed));
        // distance LOD: drop blink lights far out (they are invisible at range)
        const far = dist > 900;
        if(e.far !== far){
          e.far = far;
          if(e.beacon) e.beacon.visible = !far;
          if(e.halo) e.halo.visible = !far;
          if(e.plight) e.plight.intensity = far ? 0 : 0.7;
        }
        if(e.plight && !far) e.plight.intensity = 0.35 + blink * 0.55;
        e.fireT -= dt;
        if(e.fireT <= 0 && dist < e.type.range){
          e.fireT = e.type.fire[0] + Math.random() * (e.type.fire[1] - e.type.fire[0]);
          this._enemyFire(e, e.type.dmg);
        }
      }

      // EMP emitter input + cooldown + expanding pulse rings
      this.empCD -= dt;
      if(!this.warp && this.empCD <= 0 && inp.pressed('KeyF') && PD.hasModule('emp')) this._fireEMP();
      for(let i = this.empPulses.length - 1; i >= 0; i--){
        const ep = this.empPulses[i];
        ep.r += 520 * dt;
        ep.mesh.scale.setScalar(ep.r);
        ep.mesh.material.opacity = Math.max(0, 0.95 * (1 - ep.r / 300));
        if(ep.r >= 300){ this.scene.remove(ep.mesh); this.empPulses.splice(i, 1); }
      }

      // station drift: spin hubs, counter-rotate outer rings, blink strobes
      for(const st of this.stations){
        st.grp.rotation.y += dt * 0.12;
        if(st.ring2) st.ring2.rotation.z += dt * 0.25;
        for(let i = 0; i < st.strobes.length; i++){
          st.strobes[i].material.opacity = Math.sin(t * 5 + i * 1.05) > 0.55 ? 1 : 0.12;
        }
      }
      for(const pm of this.planetMeshes){
        pm.rotation.y += dt * 0.01;
        if(pm.userData.clouds) pm.userData.clouds.rotation.y += dt * 0.022;
      }
      if(this.nebula) this.nebula.rotation.y += dt * 0.002;

      // particles
      for(let i = this.parts.length - 1; i >= 0; i--){
        const p = this.parts[i];
        p.life -= dt;
        if(p.life <= 0){ this.scene.remove(p.mesh); this.parts.splice(i, 1); continue; }
        if(p.flash){
          const s = 1 + (p.big ? 5 : 2.4) * (1 - p.life / 0.35);
          p.mesh.scale.setScalar(s);
          p.mesh.material.opacity = p.life / 0.35;
        } else {
          p.mesh.position.addScaledVector(p.vel, dt);
          if(p.spin){ p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.y += p.spin * dt * 0.7; }
          if(p.shrink) p.mesh.scale.setScalar(Math.max(0.08, p.life / p.maxLife));
          p.mesh.material.opacity = Math.min(1, p.life * 1.4);
        }
      }

      // shield regen
      this.shieldDelay -= dt;
      const sm = PD.shieldMax();
      if(this.shieldDelay <= 0 && PD.shield < sm) PD.shield = Math.min(sm, PD.shield + 6 * dt);
      if(PD.hp < PD.hullMax() * 0.3 && Math.random() < dt * 0.5) window.GameAudio.alarm();

      // proximity prompts
      this.nearPlanet = -1;
      this.nearStation = false;
      this.nearStationIdx = -1;
      this.landPrompt = '';
      const defs = window.PLANETS;
      for(let i = 0; i < this.planetMeshes.length; i++){
        const d = defs[i];
        // Stage 1: only bodies of the current system can be landed on
        if(window.PD.systemOf('planet', i) !== (window.PD.systemIdx | 0)) continue;
        if(this.ship.position.distanceTo(this.planetMeshes[i].position) < d.size + 70){
          this.nearPlanet = i;
          this.landPrompt = 'Press <b>E</b> to land on <b>' + d.name + '</b> — ' + d.desc;
          break;
        }
      }
      if(this.nearPlanet < 0){
        for(let i = 0; i < this.stations.length; i++){
          // Stage 1: only bodies of the current system can be docked with
          if(window.PD.systemOf('station', i) !== (window.PD.systemIdx | 0)) continue;
          if(this.ship.position.distanceTo(this.stations[i].grp.position) < 160){
            this.nearStation = true;
            this.nearStationIdx = i;
            this.landPrompt = 'Press <b>E</b> to dock at <b>' + this.stations[i].def.name + '</b>';
            break;
          }
        }
      }

      // player death
      if(!PD.alive){
        window.Game.onSpaceDeath();
        return;
      }

      // camera chase
      const back = V3(0, 3.2, 11).applyQuaternion(this.ship.quaternion);
      const camTarget = this.ship.position.clone().add(back);
      if(!this.camPos) this.camPos = camTarget.clone();
      this.camPos.lerp(camTarget, Math.min(1, 6 * dt));
      const look = this.ship.position.clone().addScaledVector(fwd, 30);
      this.camera.position.copy(this.camPos);
      if(this.shake > 0){
        this.shake -= dt;
        this.camera.position.x += (Math.random() - 0.5) * this.shake * 8;
        this.camera.position.y += (Math.random() - 0.5) * this.shake * 8;
      }
      this.camera.lookAt(look);
    },

    render(){
      if(this.ready && this.active) this.renderer.render(this.scene, this.camera);
    },

    // Screen-space target list for the HUD (hover/lock logic consumes these too).
    // size = projected on-screen radius of the object; id = stable per-object identity.
    getScreenTargets(){
      const out = [];
      if(!this.active) return out;
      const v = new THREE.Vector3();
      const vh = window.innerHeight;
      const projScale = (vh * 0.5) / Math.tan(this.camera.fov * Math.PI / 360);
      const radToSize = (radius, dist) => radius / Math.max(1, dist) * projScale;
      for(let i = 0; i < this.asteroids.length; i++){
        const a = this.asteroids[i];
        const dist = a.mesh.position.distanceTo(this.ship.position);
        v.copy(a.mesh.position).project(this.camera);
        if(v.z < 1) out.push({ id: 'a' + i, x: (v.x + 1) / 2, y: (1 - v.y) / 2, type: 'ore',
          name: 'ASTEROID', kind: 'ORE BODY', value: '+2 IRON ORE', dist, size: radToSize(a.r, dist) });
      }
      for(let i = 0; i < this.pirates.length; i++){
        const p = this.pirates[i];
        const dist = p.mesh.position.distanceTo(this.ship.position);
        v.copy(p.mesh.position).project(this.camera);
        if(v.z < 1) out.push({ id: 'p' + i, x: (v.x + 1) / 2, y: (1 - v.y) / 2, type: 'pirate',
          name: p.type.name, kind: 'HOSTILE',
          value: 'BOUNTY ' + p.type.bounty[0] + '-' + p.type.bounty[1] + ' CR',
          hp: p.hp, maxHp: (p.type && p.type.hp) ? p.type.hp[1] : p.hp,
          dist, size: radToSize(5 * p.type.scale, dist) });
      }
      for(let i = 0; i < this.planetMeshes.length; i++){
        const d = window.PLANETS[i];
        // Stage B: scanner + quick travel only see bodies inside the current system
        if(window.PD.systemOf('planet', i) !== (window.PD.systemIdx | 0)) continue;
        const dist = this.planetMeshes[i].position.distanceTo(this.ship.position);
        v.copy(this.planetMeshes[i].position).project(this.camera);
        if(v.z < 1) out.push({ id: 'pl' + i, x: (v.x + 1) / 2, y: (1 - v.y) / 2, type: 'planet',
          name: d.name, kind: d.type.toUpperCase() + ' WORLD', value: 'LANDING SITE', dist,
          size: radToSize(d.size, dist) });
      }
      for(let i = 0; i < this.stations.length; i++){
        const st = this.stations[i];
        // Stage B: scanner + quick travel only see bodies inside the current system
        if(window.PD.systemOf('station', i) !== (window.PD.systemIdx | 0)) continue;
        const dist = st.grp.position.distanceTo(this.ship.position);
        v.copy(st.grp.position).project(this.camera);
        if(v.z < 1) out.push({ id: 's' + i, x: (v.x + 1) / 2, y: (1 - v.y) / 2, type: 'station',
          name: st.def.name, kind: window.PD.systemName(st.def.sys), value: 'DOCK · TRADE · MISSIONS', dist,
          size: radToSize(70, dist) });
      }
      return out;
    }
  };

  // ---- asteroid field (built once, on first enter) ----
  S.buildAsteroids = function(){
    if(this.asteroids.length) return;
    const tex = this._rockTexture();
    // 4 shared materials (fewer shader programs, faster draw-call batching)
    const astMats = [0.42, 0.5, 0.58, 0.66].map(l =>
      new THREE.MeshStandardMaterial({ map: tex,
        color: new THREE.Color().setHSL(0.6 + Math.random() * 0.06, 0.1, l),
        roughness: 0.95, metalness: 0.15 }));
    // Stage 1: ambient mining debris lives inside the current system's play volume
    const cur = window.PD.systemIdx | 0;
    const sys = (window.SYSTEMS && window.SYSTEMS[cur]) || window.SYSTEMS[0];
    const hubIdx = sys ? (sys.hub || 0) : 0;
    const c = (window.STATIONS && window.STATIONS[hubIdx] && window.STATIONS[hubIdx].pos) || [0, 0, 0];
    for(let i = 0; i < 70; i++){
      const r = 8 + Math.random() * 14;
      const mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(r, 1),
        astMats[i & 3]
      );
      mesh.position.set(c[0] + (Math.random() - 0.5) * 1400,
                         c[1] + (Math.random() - 0.5) * 900,
                         c[2] + (Math.random() - 0.5) * 1400);
      if(mesh.position.length() < 120) mesh.position.multiplyScalar(2.2);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      // slight non-uniform scale so they read as irregular rocks, not perfect polyhedra
      mesh.scale.set(0.85 + Math.random() * 0.3, 0.85 + Math.random() * 0.3, 0.85 + Math.random() * 0.3);
      this.asteroids.push({ mesh, r, hp: 20 + r * 2, spin: (Math.random() - 0.5) * 0.4 });
      this.scene.add(mesh);
    }
  };
  const _origEnter = S.enter.bind(S);
  S.enter = function(){ _origEnter(); this.buildAsteroids(); };

  window.Space = S;
})();
