'use strict';
// Stage B + Stage C tests: system-aware TAB navigation, hyperspace travel,
// hyperdrive module integration and mission-panel rendering.
//
// Run with: npm test   (or: node --test)
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_ORDER = [
  'lib/three.min.js',
  'js/audio.js',
  'js/player.js',
  'js/space3d.js',
  'js/planet2d.js',
  'js/game.js'
];

function makeEl(){
  return {
    id: '', style: {}, children: [], innerHTML: '', textContent: '', value: '',
    classList: { add(){}, remove(){}, contains(){ return false; } },
    appendChild(c){ this.children.push(c); return c; },
    addEventListener(type, cb){ if(type === 'click') this._click = cb; },
    remove(){},
    click(){ if(this._click) this._click(); },
    getContext(){ return null; }
  };
}

function makeContext(){
  const elements = {};
  const document = {
    createElement(){ return makeEl(); },
    getElementById(id){ if(!elements[id]) elements[id] = makeEl(); elements[id].id = id; return elements[id]; },
    addEventListener(){}, removeEventListener(){}
  };
  const localStorage = { data: new Map(), getItem(k){ return this.data.has(k) ? this.data.get(k) : null; },
    setItem(k, v){ this.data.set(k, String(v)); }, removeItem(k){ this.data.delete(k); } };
  const window = {
    localStorage, document, innerWidth: 1280, innerHeight: 720,
    __GALAXY_TEST__: true, addEventListener(){}, devicePixelRatio: 1
  };
  const context = vm.createContext({
    window, localStorage, document, console, Math, JSON, Date,
    Number, String, Array, Object, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() }, requestAnimationFrame(){}, setTimeout, clearTimeout,
    AudioContext: undefined, webkitAudioContext: undefined
  });
  for(const f of SCRIPT_ORDER){
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  return { window, document, context, elements };
}

function collectText(node){
  const out = [];
  out.push(node.innerHTML || node.textContent || '');
  for(const c of (node.children || [])) out.push(...collectText(c));
  return out;
}

function findButton(node, text){
  if(node.tagName === 'BUTTON' || (node.className === 'menu-btn')){
    if(node.textContent && node.textContent.includes(text)) return node;
  }
  for(const c of (node.children || [])){
    const found = findButton(c, text);
    if(found) return found;
  }
  return null;
}

// Simple Vector3-like mock for testing jumpTo positioning
function makeVec(x, y, z){
  return {
    x, y, z,
    clone(){ return makeVec(this.x, this.y, this.z); },
    sub(v){ return makeVec(this.x - v.x, this.y - v.y, this.z - v.z); },
    normalize(){
      const len = Math.sqrt(this.x*this.x + this.y*this.y + this.z*this.z);
      if(len > 0){ this.x /= len; this.y /= len; this.z /= len; }
      return this;
    },
    set(x, y, z){ this.x = x; this.y = y; this.z = z; return this; },
    copy(v){ this.x = v.x; this.y = v.y; this.z = v.z; return this; },
    addScaledVector(v, s){ this.x += v.x*s; this.y += v.y*s; this.z += v.z*s; return this; },
    length(){ return Math.sqrt(this.x*this.x + this.y*this.y + this.z*this.z); }
  };
}

function renderGalaxy(windowObj){
  const Game = windowObj.Game;
  const menu = makeEl();
  windowObj.Space.ship = { position: { x: 0, y: 0, z: 0 } };
  Game.els = {
    menuInner: menu,
    toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null }
  };
  Game._renderGalaxy();
  return menu;
}

test('hyperdrive module exists in the module marketplace and occupies a ship slot', () => {
  const { window } = makeContext();
  const PD = window.PD;
  assert.ok(window.MODULE_DEFS.hyperdrive, 'Hyperdrive module definition exists');
  assert.equal(window.MODULE_DEFS.hyperdrive.name, 'Hyperdrive');
  assert.ok(window.MODULE_DEFS.hyperdrive.cost > 0);

  // starts uninstalled
  assert.equal(PD.hasModule('hyperdrive'), false);
  assert.equal(PD.installed.length, 0);

  // purchase -> module hold, then install into an existing slot (existing bay flow)
  PD.modules.push('hyperdrive');
  assert.equal(PD.hasModuleStored('hyperdrive'), true);
  PD.installed.push('hyperdrive');
  assert.equal(PD.installed.length, 1);
  assert.ok(PD.installed.length <= window.MODULE_SLOTS, 'hyperdrive fits the 3 module slots');

  // removal returns it to the module hold immediately
  PD.installed.splice(PD.installed.indexOf('hyperdrive'), 1);
  assert.equal(PD.hasModule('hyperdrive'), false);
  assert.equal(PD.hasModuleStored('hyperdrive'), true);
});

test('TAB current-system section lists only local bodies and flags hyperspace status', () => {
  const { window } = makeContext();
  const PD = window.PD;
  PD.systemIdx = 1; // KRELL EXPANSE
  const menu = renderGalaxy(window);

  const text = collectText(menu).join('\n');
  assert.match(text, /CURRENT SYSTEM · KRELL EXPANSE/);
  assert.match(text, /KRELL EXPANSE ◀ CURRENT/);
  assert.match(text, /KRELL PRIME/);
  assert.match(text, /ASHFALL/);
  assert.match(text, /KRELL DEPOT/);
  // other systems' bodies are not local destinations
  assert.doesNotMatch(text, /TERRA PRIME/);

  // without a hyperdrive: no inter-system jump is offered
  assert.match(text, /HYPERDRIVE REQUIRED/);
  assert.doesNotMatch(text, /JUMP TO /);
});

test('TAB hyperspace section offers destination jumps only when hyperdrive is installed', () => {
  const { window } = makeContext();
  const PD = window.PD;
  PD.systemIdx = 0; // ORION REACH

  let menu = renderGalaxy(window);
  let text = collectText(menu).join('\n');
  assert.match(text, /ORION REACH ◀ CURRENT/);
  assert.doesNotMatch(text, /JUMP TO /); // no hyperdrive -> no jumps

  PD.installed.push('hyperdrive'); // buy + install via the module bay
  menu = renderGalaxy(window);
  text = collectText(menu).join('\n');
  assert.match(text, /HYPERDRIVE READY/);
  assert.match(text, /JUMP TO KRELL EXPANSE/);
  assert.match(text, /JUMP TO NOVARA SPUR/);
  assert.doesNotMatch(text, /JUMP TO ORION REACH/); // current system is not its own destination
});

test('hyperspace travel blocked without hyperdrive; started with hyperdrive after confirmation', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const Game = window.Game;
  const Space = window.Space;
  PD.systemIdx = 0;
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  window.Space.ship = { position: { x: 0, y: 0, z: 0 } };
  window.Space.pirates = [];
  window.Space.lasers = [];
  window.Space.oreDrops = [];
  window.Space.parts = [];
  window.Space.empPulses = [];

  // --- without hyperdrive: confirmation cannot start a jump ---
  PD.installed = [];
  Game._pendingJump = { system: 2 };
  let jumpedTo = null;
  const origJump = Space.hyperspaceToSystem;
  Space.hyperspaceToSystem = function(si){ jumpedTo = si; return true; };
  Game._confirmHyperspace();
  assert.equal(jumpedTo, null, 'no hyperspace jump without hyperdrive');
  assert.equal(PD.systemIdx, 0, 'player stays in ORION REACH');
  assert.equal(Game._pendingJump, null, 'pending jump cleared after attempt');

  // --- with hyperdrive: confirmation starts the jump to the chosen system ---
  PD.installed.push('hyperdrive');
  Game._pendingJump = { system: 2 };
  jumpedTo = null;
  Space.hyperspaceToSystem = function(si){ jumpedTo = si; return true; };
  Game._confirmHyperspace();
  assert.equal(jumpedTo, 2, 'hyperspace jump started to NOVARA SPUR (system 2)');
  assert.equal(Game._pendingJump, null);
  // arrival (warp completion) resolves + persists the destination system
  PD.systemIdx = window.PD.systemOf('station', window.SYSTEMS[2].hub);
  assert.equal(PD.systemIdx, 2);
  assert.equal(PD.systemName(PD.systemIdx), 'NOVARA SPUR');
  Space.hyperspaceToSystem = origJump;
});

test('TAB pause: gameplay updates paused while open, resume after close', () => {
  const { window } = makeContext();
  const Game = window.Game;
  Game.state = 'space';
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null },
               prompt: makeEl() };
  Game.input = { keys: new Set(), pressedCodes: new Set(), pressed(){ return false; }, mouseX: 0, mouseY: 0, mouseDown: false };
  Game.menuOpenNow = true;
  let updated = false;
  const origUpdate = window.Space.update;
  window.Space.update = function(){ updated = true; };
  Game.update(0.016);
  assert.equal(updated, false, 'gameplay paused while TAB menu is open');
  Game.menuClose();
  assert.equal(Game.menuOpenNow, false);
  Game.update(0.016);
  assert.equal(updated, true, 'gameplay resumed after closing the TAB menu');
  window.Space.update = origUpdate;
});

test('solar-system isolation: only the current system active in the 3D world is visible', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const S = window.Space;
  // seed the world bodies the way Space.init would (indices align with SYSTEMS)
  S.scene = { children: [], add(o){ this.children.push(o); }, remove(o){ const i=this.children.indexOf(o); if(i>=0) this.children.splice(i,1); } };
  S.stations = [];
  for(let i = 0; i < window.STATIONS.length; i++) S.stations.push({ grp: { visible: true, parent: null }, def: window.STATIONS[i] });
  S.planetMeshes = [];
  for(let i = 0; i < window.PLANETS.length; i++) S.planetMeshes.push({ visible: true, parent: null });

  for(const si of [0, 1, 2]){
    PD.systemIdx = si;
    S.syncWorld();
    // current system's hub station + planets are active
    assert.equal(S.stations[si].grp.visible, true, 'system ' + si + ' hub visible');
    assert.equal(S.planetMeshes[2 * si].visible, true, 'system ' + si + ' planet A visible');
    assert.equal(S.planetMeshes[2 * si + 1].visible, true, 'system ' + si + ' planet B visible');
    // every other system is fully removed from the active world
    for(let i = 0; i < S.stations.length; i++){
      const st = S.stations[i];
      assert.equal(st.grp.visible, i === si, 'system ' + si + ' station ' + i + ' visibility');
    }
    for(let pi = 0; pi < S.planetMeshes.length; pi++){
      const pSys = Math.floor(pi / 2);
      assert.equal(S.planetMeshes[pi].visible, pSys === si, 'system ' + si + ' planet visibility ' + pi);
    }
  }
});

test('solar-system isolation: arriving in a destination system hides the previous one', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const S = window.Space;
  S.scene = { children: [], add(o){ this.children.push(o); }, remove(o){ const i=this.children.indexOf(o); if(i>=0) this.children.splice(i,1); } };
  S.stations = [];
  for(let i = 0; i < window.STATIONS.length; i++) S.stations.push({ grp: { visible: true, parent: null }, def: window.STATIONS[i] });
  S.planetMeshes = [];
  for(let i = 0; i < window.PLANETS.length; i++) S.planetMeshes.push({ visible: true, parent: null });

  // player travels ORION REACH -> NOVARA SPUR via hyperspace arrival
  PD.systemIdx = 0;
  S.syncWorld();
  assert.equal(S.stations[0].grp.visible, true);
  assert.equal(S.planetMeshes[0].visible, true);
  assert.equal(S.planetMeshes[1].visible, true);

  PD.systemIdx = 2; // hyperspace arrival resolves the destination system
  S.syncWorld();
  assert.equal(S.stations[2].grp.visible, true, 'NOVARA SPUR hub visible after arrival');
  assert.equal(S.planetMeshes[4].visible, true, 'NOVARA visible after arrival');
  assert.equal(S.planetMeshes[5].visible, true, 'UMBRA visible after arrival');
  assert.equal(S.stations[0].grp.visible, false, 'ORION REACH hub hidden after arrival');
  assert.equal(S.planetMeshes[0].visible, false, 'TERRA PRIME hidden after arrival');
  assert.equal(S.planetMeshes[1].visible, false, 'VERDANT hidden after arrival');
});

test('TAB render exposes the ACTIVE MISSIONS section header', () => {
  const { window } = makeContext();
  const PD = window.PD;
  PD.missions.push({
    type: 'delivery', good: 'ore', qty: 5, dest: { kind: 'planet', idx: 4, name: 'NOVARA' },
    label: 'Deliver 5 Iron Ore → NOVARA', desc: 'Haul ore to NOVARA.', reward: 300
  });
  const menu = renderGalaxy(window);
  const text = collectText(menu).join('\n');
  assert.match(text, /ACTIVE MISSIONS/);
  assert.match(text, /Deliver 5 Iron Ore → NOVARA/);
  assert.match(text, /NOVARA \[NOVARA SPUR\]/);
});

test('openStation(stationIdx) docks at the clicked station, not the nearest one', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const Game = window.Game;
  Game.menuOpenNow = false;
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  // Set nearStationIdx to a different station (0 = Orion) but click dock for station 1 (Krell Depot)
  window.Space.nearStationIdx = 0;
  Game.openStation(1);
  assert.equal(Game.stationIdx, 1, 'stationIdx should be the clicked station (1 = Krell Depot)');
  assert.equal(PD.systemIdx, 1, 'systemIdx should match the clicked station system');
});

test('TAB Dock/Land enabled from any distance when no pirates are present', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const S = window.Space;
  const Game = window.Game;
  PD.systemIdx = 0; // ORION REACH
  S.ship = { position: { x: 5000, y: 0, z: 0 } }; // far from everything
  S.pirates = []; // no pirates
  S.stations = [];
  for(let i = 0; i < window.STATIONS.length; i++) S.stations.push({ grp: { position: { x: 0, y: 0, z: 0 } } });
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  Game._renderGalaxy();
  const dockBtn = findButton(Game.els.menuInner, 'DOCK');
  const landBtn = findButton(Game.els.menuInner, 'LAND');
  assert.ok(dockBtn, 'DOCK button should exist');
  assert.ok(landBtn, 'LAND button should exist');
  assert.equal(dockBtn.disabled, false, 'DOCK should be enabled from any distance without pirates');
  assert.equal(landBtn.disabled, false, 'LAND should be enabled from any distance without pirates');
});

test('TAB Dock blocked when pirates present and station outside E range (160u)', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const S = window.Space;
  const Game = window.Game;
  PD.systemIdx = 0;
  S.ship = { position: { x: 1000, y: 0, z: 0 } }; // 1000u from Orion Station at [0,0,0]
  S.pirates = [{ disabledT: 0 }]; // pirates present
  S.stations = [];
  for(let i = 0; i < window.STATIONS.length; i++) S.stations.push({ grp: { position: { x: 0, y: 0, z: 0 } } });
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  Game._renderGalaxy();
  const dockBtn = findButton(Game.els.menuInner, 'DOCK');
  assert.equal(dockBtn.disabled, true, 'DOCK should be blocked when station is outside E range during combat');
});

test('TAB Dock works when pirates present and station within E range (160u)', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const S = window.Space;
  const Game = window.Game;
  PD.systemIdx = 0;
  S.ship = { position: { x: 100, y: 0, z: 0 } }; // 100u from Orion Station - within E range
  S.pirates = [{ disabledT: 0 }];
  S.stations = [];
  for(let i = 0; i < window.STATIONS.length; i++) S.stations.push({ grp: { position: { x: 0, y: 0, z: 0 } } });
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  Game._renderGalaxy();
  const dockBtn = findButton(Game.els.menuInner, 'DOCK');
  assert.equal(dockBtn.disabled, false, 'DOCK should work when station is within E range during combat');
});

test('TAB Land blocked when pirates present and planet outside E range', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const S = window.Space;
  const Game = window.Game;
  PD.systemIdx = 0;
  // Terra Prime at [420, 60, -900], size 110 → E range = 180
  S.ship = { position: { x: 2000, y: 60, z: -900 } }; // far from Terra Prime
  S.pirates = [{ disabledT: 0 }];
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  Game._renderGalaxy();
  const landBtn = findButton(Game.els.menuInner, 'LAND');
  assert.equal(landBtn.disabled, true, 'LAND should be blocked when planet is outside E range during combat');
});

test('TAB Land works when pirates present and planet within E range', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const S = window.Space;
  const Game = window.Game;
  PD.systemIdx = 0;
  // Terra Prime at [420, 60, -900], size 110 → E range = 180
  S.ship = { position: { x: 450, y: 60, z: -900 } }; // 30u from Terra Prime - within E range
  S.pirates = [{ disabledT: 0 }];
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  Game._renderGalaxy();
  const landBtn = findButton(Game.els.menuInner, 'LAND');
  assert.equal(landBtn.disabled, false, 'LAND should work when planet is within E range during combat');
});

test('Pirate spawn timer tuned for ~2-3 min open-space encounter pacing', () => {
  const { window } = makeContext();
  const S = window.Space;
  // Step 3E: encounters should normally start within ~2-3 min of open-space flight.
  // Current: pirateTimer = 30 + Math.random() * 20 (avg 40s between attempts, ~65% spawn -> ~1 min mean)
  // Check by looking at the source: we can verify the timer reset value pattern
  // Step 3E: pirateTimer = 30 + Math.random() * 20 (avg 40s between attempts)
  // We verify by checking the min and max bounds in the source
  const src = require('node:fs').readFileSync(path.join(ROOT, 'js/space3d.js'), 'utf8');
  const match = src.match(/pirateTimer = (\d+) \+ Math\.random\(\) \* (\d+)/);
  assert.ok(match, 'pirateTimer reset pattern found in source');
  const min = parseInt(match[1]);
  const maxAdd = parseInt(match[2]);
  assert.equal(min, 30, 'pirateTimer minimum should be 30 (Step 3E pacing for ~2-3 min encounters)');
  assert.equal(maxAdd, 20, 'pirateTimer random add should be 20 (Step 3E pacing for ~2-3 min encounters)');
});

test('TAB Dock via jumpTo moves ship near station before opening station interface', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const S = window.Space;
  const Game = window.Game;
  PD.systemIdx = 0;
  S.scene = { children: [], add(o){ this.children.push(o); }, remove(o){ const i=this.children.indexOf(o); if(i>=0) this.children.splice(i,1); } };
  // Ship starts far from Orion Station
  S.ship = { position: makeVec(5000, 0, 0), quaternion: { setFromUnitVectors(){ return this; } } };
  S.vel = { set(){ return this; } };
  S.pirates = []; // no pirates
  S.stations = [];
  for(let i = 0; i < window.STATIONS.length; i++){
    S.stations.push({ grp: { position: makeVec(0, 0, 0), parent: null }, def: window.STATIONS[i] });
  }
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  Game._renderGalaxy();
  const dockBtn = findButton(Game.els.menuInner, 'DOCK');
  assert.ok(dockBtn, 'DOCK button should exist');
  dockBtn.click();
  // Ship should now be near Orion Station (130u pad)
  const dist = Math.hypot(S.ship.position.x, S.ship.position.y, S.ship.position.z);
  assert.ok(dist < 200, 'Ship should be near station after TAB Dock, dist=' + dist);
  assert.equal(PD.systemIdx, 0, 'systemIdx should be ORION REACH after dock');
});

test('TAB Land via jumpTo moves ship near planet before landing', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const S = window.Space;
  const Game = window.Game;
  PD.systemIdx = 0;
  S.scene = { children: [], add(o){ this.children.push(o); }, remove(o){ const i=this.children.indexOf(o); if(i>=0) this.children.splice(i,1); } };
  // Ship starts far from Terra Prime
  S.ship = { position: makeVec(5000, 0, 0), quaternion: { setFromUnitVectors(){ return this; } } };
  S.vel = { set(){ return this; } };
  S.pirates = []; // no pirates
  S.planetMeshes = [];
  for(let i = 0; i < window.PLANETS.length; i++){
    S.planetMeshes.push({ position: makeVec(window.PLANETS[i].x, window.PLANETS[i].y, window.PLANETS[i].z) });
  }
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); return c; }, firstChild: null } };
  Game._renderGalaxy();
  const landBtn = findButton(Game.els.menuInner, 'LAND');
  assert.ok(landBtn, 'LAND button should exist');
  landBtn.click();
  // Ship should now be near Terra Prime (size + 55 = 165u pad)
  const p = window.PLANETS[0];
  const dist = Math.hypot(
    S.ship.position.x - p.x, S.ship.position.y - p.y, S.ship.position.z - p.z);
  assert.ok(dist < 200, 'Ship should be near planet after TAB Land, dist=' + dist);
  assert.equal(PD.systemIdx, 0, 'systemIdx should be ORION REACH after land');
});
