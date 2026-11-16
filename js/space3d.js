(function(){
  'use strict';
  // 3D space mode: Three.js flight, laser mining, pirates, station docking.
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  const S = {
    ready: false, active: false,
    nearPlanet: -1, nearStation: false, landPrompt: '',
    stats: { speed: 0 },
    planetMeshes: [],

    init(canvas){
      if(this.ready) return;
      this.ready = true;
      this.canvas = canvas;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.FogExp2(0x04060f, 0.00035);
      this.camera = new THREE.PerspectiveCamera(68, 1, 0.5, 12000);
      this.scene.add(new THREE.AmbientLight(0x334466, 0.9));
      const sun = new THREE.PointLight(0xfff2d8, 1.1, 6000);
      sun.position.set(2000, 1500, -2200);
      this.scene.add(sun);
      this._buildStars();
      this._buildStation();
      this._buildShip();
      this._buildPlanets();
      this.asteroids = [];
      this.pirates = [];
      this.lasers = [];
      this.oreDrops = [];
      this.parts = [];
      this.fireTimer = 0; this.wing = 0;
      this.pirateTimer = 14;
      this.shieldDelay = 0;
      this.shake = 0;
      // hover targeting / lock-on state
      this.hover = null;      // screen target under the crosshair
      this.hoverId = null;
      this.lockT = 0;         // seconds held on current target
      this.lockNeed = 3;      // current lock time from scanner level
      this.locked = false;    // true once lockT >= lockNeed
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

    _buildStation(){
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
      grp.position.set(0, 0, 0);
      this.station = grp;
      this.scene.add(grp);
    },

    _buildShip(){
      this.ship = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 6.4, 8),
        new THREE.MeshStandardMaterial({ color: 0xc9d4e0, roughness: 0.35, metalness: 0.75 })
      );
      body.rotation.x = -Math.PI / 2;
      this.ship.add(body);
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.4, metalness: 0.7 });
      const wingGeo = new THREE.BoxGeometry(5.4, 0.4, 2.2);
      const wL = new THREE.Mesh(wingGeo, wingMat); wL.position.set(-3.2, -0.2, 0.6); wL.rotation.z = 0.14;
      const wR = new THREE.Mesh(wingGeo, wingMat); wR.position.set(3.2, -0.2, 0.6); wR.rotation.z = -0.14;
      this.ship.add(wL); this.ship.add(wR);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x5ff0ff });
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 1.6), glowMat);
      fin.position.set(0, 1.1, 1.2);
      this.ship.add(fin);
      this.engine = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.2, 8),
        new THREE.MeshBasicMaterial({ color: 0x7fdfff, transparent: true, opacity: 0.85 }));
      this.engine.rotation.x = Math.PI / 2;
      this.engine.position.set(0, 0, 3.6);
      this.ship.add(this.engine);
      this.scene.add(this.ship);
      this.ship.position.set(0, 0, 300);
      this.ship.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
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
        this.vel = V3(0, 0, 0);
      }
      if(!this.vel) this.vel = V3(0, 0, 0);
      window.PD.resetShipState();
      this.camPos = null;
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

    respawn(){
      this.ship.position.set(0, 40, 300);
      this.ship.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
      this.vel = V3(0, 0, 0);
      for(const p of this.pirates) this.scene.remove(p.mesh);
      this.pirates.length = 0;
      window.PD.resetShipState();
    },

    // Glowing engine exhaust particles streaming behind the ship.
    _emitTrail(dt, thrustLevel, spd){
      const rate = thrustLevel > 0 ? 85 : 12;
      this.trailAcc += rate * dt;
      const back = V3(0, 0, 4.4).applyQuaternion(this.ship.quaternion);
      while(this.trailAcc >= 1){
        this.trailAcc--;
        if(this.parts.length > 170) return;
        const jitter = V3((Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 1.3)
          .applyQuaternion(this.ship.quaternion);
        const hot = Math.random() < (thrustLevel > 0 ? 0.35 : 0.15);
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.3 + Math.random() * 0.35, 6, 5),
          new THREE.MeshBasicMaterial({
            color: hot ? (Math.random() < 0.5 ? 0xffc46b : 0xff8f5f) : 0x7fdfff,
            transparent: true, opacity: 0.85, depthWrite: false
          }));
        m.position.copy(this.ship.position).add(back).add(jitter);
        const drift = back.clone().multiplyScalar(-1).addScaledVector(this.vel, -0.25)
          .add(V3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4));
        const life = 0.3 + Math.random() * 0.45;
        this.parts.push({ mesh: m, life, maxLife: life, vel: drift, spin: 0, shrink: true, glow: true });
        this.scene.add(m);
      }
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
      } else {
        this.hover = null; this.hoverId = null; this.lockT = 0; this.locked = false;
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
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 9),
        new THREE.MeshBasicMaterial({ color: this.wing ? 0x7ff7ff : 0xaef2ff }));
      mesh.position.copy(this.ship.position).addScaledVector(right, this.wing ? -3.4 : 3.4).addScaledVector(dir, 2);
      mesh.quaternion.setFromUnitVectors(V3(0, 0, -1), dir);
      this.lasers.push({ mesh, vel: dir.clone().multiplyScalar(700), dmg, life: 1.6, mine: true });
      this.scene.add(mesh);
      window.GameAudio.laser();
    },

    _enemyFire(p){
      const toP = this.ship.position.clone().sub(p.mesh.position).normalize();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 7),
        new THREE.MeshBasicMaterial({ color: 0xff5f7a }));
      mesh.position.copy(p.mesh.position).addScaledVector(toP, 4);
      mesh.quaternion.setFromUnitVectors(V3(0, 0, -1), toP);
      this.lasers.push({ mesh, vel: toP.multiplyScalar(520), dmg: 7, life: 1.8, mine: false });
      this.scene.add(mesh);
      window.GameAudio.tone ? window.GameAudio.laser() : 0;
    },

    _spawnPirate(){
      if(this.pirates.length >= 4) return;
      const grp = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x9a3546, roughness: 0.5, metalness: 0.6 });
      const body = new THREE.Mesh(new THREE.ConeGeometry(1.8, 5.5, 6), mat);
      body.rotation.x = Math.PI / 2;
      grp.add(body);
      const w = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.5, 2), mat);
      grp.add(w);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.7, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xff5f7a }));
      eye.position.set(0, 0, -2.2);
      grp.add(eye);
      const dir = V3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize();
      grp.position.copy(this.ship.position).addScaledVector(dir, 420);
      const p = { mesh: grp, hp: 26 + Math.random() * 18, fireT: 1 + Math.random(), vel: V3(0,0,0) };
      grp.lookAt(this.ship.position);
      this.pirates.push(p);
      this.scene.add(grp);
      window.GameAudio.alarm();
      window.Game.uiToast('⚠ PIRATE DETECTED');
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

    _collideAsteroids(){
      // lazy rebuild of simple sphere list for laser checks
      return this.asteroids;
    },

    update(dt){
      if(!this.active) return;
      const G = window.Game, PD = window.PD;
      const inp = G.input;
      const t = performance.now() / 1000;

      // steering: mouse offset from center = turn rate (GOF2 virtual-stick feel)
      // No roll input: yaw + pitch only, with auto-level to prevent upside-down drift.
      const mx = inp.mouseX, my = inp.mouseY; // normalized -1..1
      const dead = 0.06;
      const steer = v => Math.abs(v) < dead ? 0 : (v - Math.sign(v) * dead) / (1 - dead);
      const keyYaw = (inp.keys.has('KeyD') ? 1 : 0) - (inp.keys.has('KeyA') ? 1 : 0);
      const keyPitch = (inp.keys.has('ArrowDown') ? 1 : 0) - (inp.keys.has('ArrowUp') ? 1 : 0);
      const yawRate = steer(mx) * -1.6 - keyYaw * 1.15;
      const pitchRate = steer(my) * -1.25 + keyPitch * 0.9;
      this.ship.rotateY(yawRate * dt);
      this.ship.rotateX(pitchRate * dt);

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

      // thrust
      const fwd = V3(0, 0, -1).applyQuaternion(this.ship.quaternion);
      let thrustLevel = 0;
      if(inp.keys.has('KeyW')){ this.vel.addScaledVector(fwd, PD.thrust() * dt); thrustLevel = 1; }
      if(inp.keys.has('KeyS')) this.vel.multiplyScalar(Math.max(0, 1 - 1.8 * dt));
      this.vel.multiplyScalar(Math.max(0, 1 - 0.25 * dt));
      const spd = this.vel.length(), maxS = PD.maxSpeed();
      if(spd > maxS) this.vel.multiplyScalar(maxS / spd);
      this.ship.position.addScaledVector(this.vel, dt);
      this.stats.speed = spd;
      window.GameAudio.engine(0.12 + thrustLevel * 0.85 * (spd / maxS));
      this.engine.scale.setScalar(0.6 + thrustLevel * (0.6 + Math.random() * 0.25));
      if(spd > 30) this.ship.position.y += Math.sin(t * 30) * 0.01;
      this._emitTrail(dt, thrustLevel, spd);

      // hover targeting & lock-on (scanner-gated)
      this._updateLock(dt);

      // fire
      this.fireTimer -= dt;
      if(inp.mouseDown || inp.keys.has('Space')){
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
                  const ore = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 0),
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
                if(e.hp <= 0){
                  this._spawnExplosion(e.mesh.position, true);
                  window.GameAudio.bigBoom();
                  const bounty = 40 + Math.floor(Math.random() * 60);
                  PD.credits += bounty;
                  window.Game.uiToast('+' + bounty + ' CR bounty');
                  PD.save();
                  this.scene.remove(e.mesh);
                  this.pirates.splice(p, 1);
                }
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
        if(o.mesh.position.distanceTo(this.ship.position) < 26){
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
        this.pirateTimer = 22 + Math.random() * 18;
        if(Math.random() < 0.65) this._spawnPirate();
      }
      for(const e of this.pirates){
        const toShip = this.ship.position.clone().sub(e.mesh.position);
        const dist = toShip.length();
        toShip.normalize();
        const desired = toShip.multiplyScalar(Math.max(0, dist - 60) * 1.1);
        e.vel.lerp(desired.clampLength(0, 55), 0.03);
        e.mesh.position.addScaledVector(e.vel, dt);
        e.mesh.lookAt(this.ship.position);
        e.fireT -= dt;
        if(e.fireT <= 0 && dist < 380){
          e.fireT = 1.1 + Math.random() * 0.8;
          this._enemyFire(e);
        }
      }

      // station drift
      this.station.rotation.y += dt * 0.12;
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
      this.landPrompt = '';
      const defs = window.PLANETS;
      for(let i = 0; i < this.planetMeshes.length; i++){
        const d = defs[i];
        if(this.ship.position.distanceTo(this.planetMeshes[i].position) < d.size + 70){
          this.nearPlanet = i;
          this.landPrompt = 'Press <b>E</b> to land on <b>' + d.name + '</b> — ' + d.desc;
          break;
        }
      }
      if(this.ship.position.length() < 160){
        this.nearStation = true;
        this.landPrompt = 'Press <b>E</b> to dock at <b>ORION STATION</b>';
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
          name: 'VOID RAIDER', kind: 'HOSTILE', value: 'BOUNTY 40-100 CR', dist, size: radToSize(5, dist) });
      }
      for(let i = 0; i < this.planetMeshes.length; i++){
        const d = window.PLANETS[i];
        const dist = this.planetMeshes[i].position.distanceTo(this.ship.position);
        v.copy(this.planetMeshes[i].position).project(this.camera);
        if(v.z < 1) out.push({ id: 'pl' + i, x: (v.x + 1) / 2, y: (1 - v.y) / 2, type: 'planet',
          name: d.name, kind: d.type.toUpperCase() + ' WORLD', value: 'LANDING SITE', dist,
          size: radToSize(d.size, dist) });
      }
      if(this.station){
        const dist = this.station.position.distanceTo(this.ship.position);
        v.copy(this.station.position).project(this.camera);
        if(v.z < 1) out.push({ id: 'station', x: (v.x + 1) / 2, y: (1 - v.y) / 2, type: 'station',
          name: 'ORION STATION', kind: 'TRADE HUB', value: 'DOCK · TRADE · UPGRADE', dist,
          size: radToSize(70, dist) });
      }
      return out;
    }
  };

  // ---- asteroid field (built once, on first enter) ----
  S.buildAsteroids = function(){
    if(this.asteroids.length) return;
    const tex = this._rockTexture();
    for(let i = 0; i < 70; i++){
      const r = 8 + Math.random() * 14;
      const tint = new THREE.Color().setHSL(0.6 + Math.random() * 0.08, 0.08 + Math.random() * 0.1,
        0.42 + Math.random() * 0.3);
      const mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(r, 1),
        new THREE.MeshStandardMaterial({ map: tex, color: tint, roughness: 0.95, metalness: 0.15 })
      );
      mesh.position.set((Math.random() - 0.5) * 3000, (Math.random() - 0.5) * 1400, (Math.random() - 0.5) * 3000);
      if(mesh.position.length() < 300) mesh.position.multiplyScalar(2.2);
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
