'use strict';
// Final mission and equipment regression tests.
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

function makeEl() {
  return {
    id: '', style: {}, children: [], innerHTML: '', textContent: '', value: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, cb) { if (type === 'click') this._click = cb; },
    remove() {},
    click() { if (this._click) this._click(); },
    getContext() { return null; }
  };
}

function makeContext(seedSave) {
  const elements = {};
  const document = {
    createElement() { return makeEl(); },
    getElementById(id) { if (!elements[id]) elements[id] = makeEl(); elements[id].id = id; return elements[id]; },
    addEventListener() {}, removeEventListener() {}
  };
  const data = new Map();
  if (seedSave) data.set('galaxy-one-save', JSON.stringify(seedSave));
  const localStorage = {
    data,
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); }
  };
  const window = {
    localStorage, document, innerWidth: 1280, innerHeight: 720,
    __GALAXY_TEST__: true, addEventListener() {}, devicePixelRatio: 1
  };
  const context = vm.createContext({
    window, localStorage, document, console, Math, JSON, Date,
    Number, String, Array, Object, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() }, requestAnimationFrame() {}, setTimeout, clearTimeout,
    AudioContext: undefined, webkitAudioContext: undefined
  });
  for (const f of SCRIPT_ORDER) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  return { window, document, context, elements, localStorage };
}

function collectText(node) {
  const out = [];
  out.push(node.innerHTML || node.textContent || '');
  for (const c of (node.children || [])) out.push(...collectText(c));
  return out;
}

function collectButtons(node, out) {
  if (!node) return out;
  for (const c of (node.children || [])) {
    if (typeof c._click === 'function') out.push(c);
    collectButtons(c, out);
  }
  return out;
}

function setupSpace(windowObj) {
  const S = windowObj.Space;
  const Game = windowObj.Game;
  S.pirates = [];
  S.lasers = [];
  S.oreDrops = [];
  S.empPulses = [];
  S.parts = [];
  S._pCache = {};
  S._panelTexture = () => ({});
  S.scene = {
    children: [],
    add(o) { this.children.push(o); },
    remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); }
  };
  S.ship = { position: { x: 0, y: 0, z: 0 } };
  if (!Game.els) Game.els = {};
  Game.els.toasts = { children: [], appendChild(c) { this.children.push(c); return c; }, firstChild: { remove() {} } };
  Game.uiToast = function () {};
  return { S, Game };
}

test('System Defence spawns exactly the requested group for 3, 4 and 5', () => {
  for (const need of [3, 4, 5]) {
    const { window } = makeContext();
    const PD = window.PD;
    const { S, Game } = setupSpace(window);
    PD.systemIdx = 0;
    PD.missions = [{
      type: 'defence', id: 'defence-spawn-' + need, need, have: 0,
      dest: null, destSystem: 0, pirates: [], piratesGenerated: false
    }];
    S._spawnMissionEncounters();
    assert.equal(S.pirates.length, need, 'spawned ' + need + ' mission pirates');
    for (const p of S.pirates) {
      assert.equal(p.missionId, 'defence-spawn-' + need, 'mission identity assigned');
      assert.ok(p.type && p.mesh, 'valid spawned pirate');
      assert.equal(p.disabledT || 0, 0, 'spawned pirate is active');
    }
  }
});

test('System Defence kill tracking counts only assigned pirates', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const { S } = setupSpace(window);
  const mi = {
    type: 'defence', id: 'defence-kill-0', need: 2, have: 0,
    dest: null, destSystem: 0, pirates: [], piratesGenerated: true
  };
  PD.missions = [mi];

  const assigned = { mesh: { position: { x: 0, y: 0, z: 0 } }, type: { bounty: [0, 0] }, missionId: mi.id, hp: 10 };
  S.pirates.push(assigned);
  S._killPirate(assigned);
  assert.equal(mi.have, 1, 'assigned kill increments defence progress');

  const ordinary = { mesh: { position: { x: 0, y: 0, z: 0 } }, type: { bounty: [0, 0] }, missionId: null, hp: 10 };
  S.pirates.push(ordinary);
  S._killPirate(ordinary);
  assert.equal(mi.have, 1, 'ordinary kill does not count');
});

test('System Defence completes and pays once after all assigned kills', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const Game = window.Game;
  const { S } = setupSpace(window);
  const mi = {
    type: 'defence', id: 'defence-complete-0', need: 2, have: 0,
    dest: null, destSystem: 0, pirates: [], piratesGenerated: true,
    reward: 280
  };
  PD.missions = [mi];
  PD.credits = 400;
  const first = { mesh: { position: { x: 0, y: 0, z: 0 } }, type: { bounty: [0, 0] }, missionId: mi.id, hp: 10 };
  const second = { mesh: { position: { x: 0, y: 0, z: 0 } }, type: { bounty: [0, 0] }, missionId: mi.id, hp: 10 };
  S.pirates.push(first, second);
  S._killPirate(first);
  S._killPirate(second);
  Game._checkMissions();
  assert.equal(PD.missions.length, 0, 'defence mission removed after completion');
  assert.equal(PD.credits, 680, 'defence reward paid once');
});

test('System Defence leave and return restores un-killed enemies without duplicates', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const { S } = setupSpace(window);
  PD.systemIdx = 0;
  PD.missions = [{
    type: 'defence', id: 'defence-return-0', need: 5, have: 0,
    dest: null, destSystem: 0, pirates: [], piratesGenerated: false
  }];
  S._spawnMissionEncounters();
  assert.equal(S.pirates.length, 5);
  const killed = S.pirates[0];
  S._killPirate(killed);
  assert.equal(PD.missions[0].have, 1);
  S.clearTransient();
  assert.equal(S.pirates.length, 0);
  S._spawnMissionEncounters();
  assert.equal(S.pirates.length, 4, 'only un-killed enemies are restored');
  for (const p of S.pirates) assert.equal(p.missionId, 'defence-return-0');
});

test('System Defence save/load preserves encounter progress', () => {
  const first = makeContext();
  const PD = first.window.PD;
  PD.systemIdx = 0;
  PD.missions = [{
    type: 'defence', id: 'defence-save-0', need: 4, have: 2,
    dest: null, destSystem: 0, pirates: [], piratesGenerated: true
  }];
  PD.save();
  const saved = JSON.parse(first.localStorage.getItem('galaxy-one-save'));

  const second = makeContext(saved);
  const PD2 = second.window.PD;
  const { S } = setupSpace(second.window);
  PD2.systemIdx = 0;
  S._spawnMissionEncounters();
  assert.equal(S.pirates.length, 2, 'saved kill count restores remaining enemies');
  assert.equal(PD2.missions[0].have, 2, 'kill count preserved');
});

test('Equipment and Marketplace categories are reorganised', () => {
  const { window } = makeContext();
  const Game = window.Game;
  const PD = window.PD;
  PD.credits = 1000;
  PD.marketStock['station'] = { energyCells: 1, missiles: 1, weapons: { laserpistol: 1, assaultrifle: 1 } };

  const equipmentMenu = makeEl();
  Game.els = { menuInner: equipmentMenu, toasts: { children: [], appendChild(c) { this.children.push(c); return c; }, firstChild: null } };
  Game._renderEquipment(equipmentMenu);
  const equipmentText = collectText(equipmentMenu).join('\n');
  assert.match(equipmentText, /PLANETARY GEAR/);
  assert.match(equipmentText, /SHIP GEAR/);
  assert.match(equipmentText, /SHIP MODULES/);
  assert.match(equipmentText, /Laser Pistol/);
  assert.match(equipmentText, /Assault Rifle/);
  assert.match(equipmentText, /Pulse Rounds/);
  assert.match(equipmentText, /Medkit/);
  assert.match(equipmentText, /Missiles/);
  assert.match(equipmentText, /Homing Missile System/);

  const marketMenu = makeEl();
  Game._renderMarket(marketMenu);
  const marketText = collectText(marketMenu).join('\n');
  assert.match(marketText, /SELL CARGO/);
  assert.match(marketText, /COMMODITY EXCHANGE/);
  assert.doesNotMatch(marketText, /PLANETARY GEAR/);
  assert.doesNotMatch(marketText, /SHIP GEAR/);
});

test('Equipment item definitions, stock and references remain intact', () => {
  const { window } = makeContext();
  assert.equal(window.WEAPON_DEFS.laserpistol.dmg, 10);
  assert.equal(window.WEAPON_DEFS.laserpistol.delay, 0.5);
  assert.equal(window.WEAPON_DEFS.assaultrifle.dmg, 6);
  assert.equal(window.WEAPON_DEFS.assaultrifle.delay, 0.2);
  assert.ok(window.MODULE_DEFS.missiles, 'Homing Missile System definition exists');
  assert.equal(window.MODULE_DEFS.missiles.name, 'Homing Missile System');
  const PD = window.PD;
  assert.equal(typeof PD.sellWeapon, 'function');
  assert.equal(typeof PD.sellEnergyCells, 'function');
  assert.equal(typeof PD.hasWeapon, 'function');

  const gameSrc = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');
  const equipmentSrc = gameSrc.match(/_renderEquipment\(m\)\{[\s\S]*?_renderMarket\(m\)\{/)[0];
  assert.match(equipmentSrc, /PD\.weapons\.push\('laserpistol'\)/);
  assert.match(equipmentSrc, /PD\.weapons\.push\('assaultrifle'\)/);
  assert.match(equipmentSrc, /PD\.energyCells\+\+/);
  assert.match(equipmentSrc, /stock\.energyCells--/);
  assert.match(equipmentSrc, /PD\.missiles\+\+/);
  assert.match(equipmentSrc, /stock\.missiles--/);
  assert.match(equipmentSrc, /PD\.sellWeapon\('laserpistol'\)/);
  assert.match(equipmentSrc, /PD\.sellWeapon\('assaultrifle'\)/);
  assert.match(equipmentSrc, /PD\.sellEnergyCells\(PD\.energyCells\)/);
});