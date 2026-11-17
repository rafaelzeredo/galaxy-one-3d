'use strict';
// Living World Update tests: alien movement balance, marketplace stock rotation,
// natural resource regeneration, Pulse Rounds naming and persistence.
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

function makeContext(seedSave){
  const elements = {};
  const document = {
    createElement(){ return makeEl(); },
    getElementById(id){ if(!elements[id]) elements[id] = makeEl(); elements[id].id = id; return elements[id]; },
    addEventListener(){}, removeEventListener(){}
  };
  const data = new Map();
  if(seedSave) data.set('galaxy-one-save', JSON.stringify(seedSave));
  const localStorage = { data,
    getItem(k){ return data.has(k) ? data.get(k) : null; },
    setItem(k, v){ data.set(k, String(v)); },
    removeItem(k){ data.delete(k); } };
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
  return { window, document, context, elements, localStorage };
}

test('alien movement: hostile chasers move at player-run speed or faster', () => {
  const { window } = makeContext();
  const PL = window.Planet;
  // hostile world (Ashfall, alienRate 1.9): chaser ≈ player run speed, slightly faster
  const hostileSpd = PL.alienSpeed(1.9, false);
  assert.ok(hostileSpd >= 150, 'hostile chaser is at or above player run speed: ' + hostileSpd);
  // peaceful world (Terra Prime, alienRate 0.25): gentler pack stays slower than the player
  const peacefulSpd = PL.alienSpeed(0.25, false);
  assert.ok(peacefulSpd < hostileSpd, 'peaceful chaser is slower than hostile chaser');
  assert.ok(peacefulSpd < 150, 'peaceful chaser does not overrun the player: ' + peacefulSpd);
});

test('alien movement: some alien types slightly exceed player-run speed, others slower', () => {
  const { window } = makeContext();
  const PL = window.Planet;
  // mixed hostility (Verdant, alienRate 0.7): chaser ~128u/s (player run is 150)
  const mixedSpd = PL.alienSpeed(0.7, false);
  assert.ok(mixedSpd > 100 && mixedSpd < 150, 'mixed chaser between slow and player-run: ' + mixedSpd);
  // hostile swarm (Krell Prime, alienRate 1.6): chaser ~186u/s (slightly faster than player run)
  const swarmSpd = PL.alienSpeed(1.6, false);
  assert.ok(swarmSpd > PL.alienSpeed(0.7, false), 'more hostile -> faster chaser');
  assert.ok(swarmSpd > 150, 'hostile swarm chaser exceeds player run speed: ' + swarmSpd);
});

test('alien movement: spitters retain a slower ranged archetype than chasers', () => {
  const { window } = makeContext();
  const PL = window.Planet;
  const sp = PL.alienSpeed(1.9, true);
  const ch = PL.alienSpeed(1.9, false);
  assert.ok(sp < ch, 'spitter is slower than chaser: ' + sp + ' < ' + ch);
  assert.ok(sp < 150, 'spitter stays below player run speed (ranged kiting archetype): ' + sp);
});

test('alien movement: spawned aliens use the tuned speed', () => {
  const { window } = makeContext();
  const PL = window.Planet;
  PL.planet = window.PLANETS[1];
  PL.player = { x: 1000, y: 1000 };
  PL.aliens = [];
  PL._spawnAlien(false);
  assert.ok(PL.aliens.length > 0, 'alien spawned');
  assert.equal(PL.aliens[0].speed, PL.alienSpeed(PL.planet.alienRate, false));
});

test('stock rotation: clears cached vendor stock for the system being left', () => {
  const { window } = makeContext();
  const PD = window.PD;
  PD.marketStock['station'] = { energyCells: 3, weapons: { laserpistol: 1 } };
  PD.marketStock['p0'] = { energyCells: 2, weapons: {} };
  PD.marketStock['p1'] = { energyCells: 1, weapons: {} };
  PD.marketStock['p4'] = { energyCells: 0, weapons: { assaultrifle: 1 } };
  assert.equal(PD.rotateStockForSystem(0), true, 'ORION REACH vendors had cached stock');
  assert.equal(PD.marketStock['station'], undefined, 'station stock rotated away');
  assert.equal(PD.marketStock['p0'], undefined, 'TERRA PRIME trader stock rotated away');
  assert.equal(PD.marketStock['p1'], undefined, 'VERDANT trader stock rotated away');
  assert.ok(PD.marketStock['p4'], 'NOVARA vendor stock untouched (other system)');
});

test('stock rotation: owned equipment is never removed or restocked', () => {
  const { window } = makeContext();
  const PD = window.PD;
  PD.weapons = ['laserpistol'];
  PD.equippedWeapon = 'laserpistol';
  PD.marketStock['station'] = { energyCells: 2, weapons: { laserpistol: 1 } };
  assert.equal(PD.rotateStockForSystem(2), true);
  const stock = window.Game._marketStock('station');
  assert.equal(stock.weapons.laserpistol, undefined, 'owned weapon is not restocked');
  assert.ok(PD.hasWeapon('laserpistol'), 'owned weapon remains owned');
  assert.equal(PD.equippedWeapon, 'laserpistol', 'owned weapon stays equipped');
});

test('stock rotation: opening a shop does not rotate stock', () => {
  const { window } = makeContext();
  const PD = window.PD;
  PD.marketStock['station'] = { energyCells: 4, weapons: {} };
  const s1 = window.Game._marketStock('station');
  const s2 = window.Game._marketStock('station');
  assert.equal(s1, s2, 'cached stock is stable while the vendor is visited');
  assert.equal(s1.energyCells, 4);
});

test('stock rotation: leaving a system via hyperspace triggers vendor stock rotation', () => {
  const { window } = makeContext();
  const PD = window.PD;
  const Game = window.Game;
  const Space = window.Space;
  PD.systemIdx = 0;
  PD.installed = ['hyperdrive'];
  PD.marketStock['station'] = { energyCells: 5, weapons: {} };
  PD.marketStock['p0'] = { energyCells: 2, weapons: {} };
  Game.els = { menuInner: makeEl(), menu: makeEl(), toasts: { children: [], appendChild(c){ this.children.push(c); }, firstChild: null } };
  window.Space.ship = { position: { x: 0, y: 0, z: 0 } };
  window.Space.pirates = [];
  Game._pendingJump = { system: 2 };
  let jumpedTo = null;
  const orig = Space.hyperspaceToSystem;
  Space.hyperspaceToSystem = function(si){ jumpedTo = si; return true; };
  Game._confirmHyperspace();
  Space.hyperspaceToSystem = orig;
  assert.equal(jumpedTo, 2, 'hyperspace jump started to NOVARA SPUR');
  assert.equal(PD.marketStock['station'], undefined, 'vendor stock of ORION REACH rotated on departure');
  assert.equal(PD.marketStock['p0'], undefined, 'planetary trader stock of ORION REACH rotated on departure');
});

test('resource regeneration: depleted nodes regrow gradually over time', () => {
  const { window } = makeContext();
  const PL = window.Planet;
  const PD = window.PD;
  const now = 1730000000000;
  PD.surfaceStates = {
    0: {
      trees:    [{ x: 10, y: 10, hp: 0, seed: 1, depletedAt: now - 4000 }],
      rocks:    [{ x: 20, y: 20, hp: 0, seed: 2, depletedAt: now - 1000 }],
      crystals: [{ x: 30, y: 30, hp: 0, seed: 3, depletedAt: now - 100000 }]
    }
  };
  PL.regenResources(now);
  assert.equal(PD.surfaceStates[0].trees[0].hp, 1, 'tree recovered ~1 unit after ~4s of regrowth');
  assert.equal(PD.surfaceStates[0].rocks[0].hp, 0, 'iron ore not yet recovered after only 1s');
  assert.equal(PD.surfaceStates[0].crystals[0].hp, 2, 'crystal recovered ~2 units after 100s');
});

test('resource regeneration: short absence does not fully replenish depleted resources', () => {
  const { window } = makeContext();
  const PL = window.Planet;
  const PD = window.PD;
  const now = 1730000000000;
  PD.surfaceStates = {
    0: {
      trees:    [{ x: 10, y: 10, hp: 0, seed: 1, depletedAt: now - 100 }],
      rocks:    [{ x: 20, y: 20, hp: 0, seed: 2, depletedAt: now - 100 }],
      crystals: [{ x: 30, y: 30, hp: 0, seed: 3, depletedAt: now - 100 }]
    }
  };
  PL.regenResources(now);
  const st = PD.surfaceStates[0];
  assert.equal(st.trees[0].hp, 0, 'short absence regrows nothing yet');
  assert.equal(st.rocks[0].hp, 0, 'short absence regrows nothing yet');
  assert.equal(st.crystals[0].hp, 0, 'short absence regrows nothing yet');
});

test('resource regeneration: long absence fully replenishes depleted nodes', () => {
  const { window } = makeContext();
  const PL = window.Planet;
  const PD = window.PD;
  const now = 1730000000000;
  PD.surfaceStates = {
    0: {
      trees:    [{ x: 10, y: 10, hp: 0, seed: 1, depletedAt: now - 120000 }],
      rocks:    [{ x: 20, y: 20, hp: 0, seed: 2, depletedAt: now - 120000 }],
      crystals: [{ x: 30, y: 30, hp: 0, seed: 3, depletedAt: now - 120000 }]
    }
  };
  PL.regenResources(now);
  const st = PD.surfaceStates[0];
  assert.equal(st.trees[0].hp, 3, 'trees fully regenerated after long absence');
  assert.equal(st.rocks[0].hp, 3, 'iron ore fully regenerated after long absence');
  assert.equal(st.crystals[0].hp, 3, 'crystals fully regenerated after long absence');
});

test('resource regeneration: different resource types regenerate at different rates', () => {
  const { window } = makeContext();
  const PL = window.Planet;
  const PD = window.PD;
  const now = 1730000000000;
  PD.surfaceStates = {
    0: {
      trees:    [{ x: 10, y: 10, hp: 0, seed: 1, depletedAt: now - 20000 }],
      rocks:    [{ x: 20, y: 20, hp: 0, seed: 2, depletedAt: now - 20000 }],
      crystals: [{ x: 30, y: 30, hp: 0, seed: 3, depletedAt: now - 20000 }]
    }
  };
  PL.regenResources(now);
  const st = PD.surfaceStates[0];
  // 10s elapsed: tree (0.30/hp/s) -> ~3 units; rock (0.05) -> ~0; crystal (0.025) -> ~0
  assert.ok(st.trees[0].hp > st.rocks[0].hp, 'trees regenerate faster than iron ore');
  assert.ok(st.trees[0].hp > st.crystals[0].hp, 'trees regenerate faster than crystals');
  assert.ok(st.rocks[0].hp > st.crystals[0].hp, 'iron ore regenerates faster than crystals');
});

test('save/load preserves resource regen state and vendor stock', () => {
  const first = makeContext();
  const PD = first.window.PD;
  PD.marketStock['station'] = { energyCells: 2, weapons: {} };
  PD.surfaceStates = { 0: { trees: [{ x: 1, y: 1, hp: 0, seed: 1, depletedAt: 12345 }] } };
  PD.save();
  const saved = JSON.parse(first.localStorage.getItem('galaxy-one-save'));
  assert.equal(saved.surfaceStates[0].trees[0].hp, 0);
  assert.equal(saved.marketStock.station.energyCells, 2);

  const second = makeContext(saved);
  assert.equal(second.window.PD.surfaceStates[0].trees[0].hp, 0, 'depletion state persists through save/load');
  assert.equal(second.window.PD.marketStock['station'].energyCells, 2, 'market stock persists through save/load');
});

test('Pulse Rounds is the player-facing ammunition name', () => {
  const g = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');
  const p2 = fs.readFileSync(path.join(ROOT, 'js/planet2d.js'), 'utf8');
  const pl = fs.readFileSync(path.join(ROOT, 'js/player.js'), 'utf8');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(g.includes('Pulse Rounds'), 'station market uses Pulse Rounds');
  assert.ok(g.includes('Sell Pulse Rounds'), 'station market sell row uses Pulse Rounds');
  assert.ok(g.includes('PULSE ROUNDS'), 'HUD uses PULSE ROUNDS');
  assert.ok(p2.includes('PULSE ROUNDS'), 'planet canvas HUD uses PULSE ROUNDS');
  assert.ok(pl.includes('Pulse Rounds'), 'weapon defs use Pulse Rounds');
  assert.ok(idx.includes('PULSE ROUNDS'), 'HUD initial markup uses PULSE ROUNDS');
  assert.ok(!g.includes('Energy Cells'), 'no stale Energy Cells display strings remain');
  assert.ok(!p2.includes('ENERGY CELLS'), 'no stale ENERGY CELLS canvas text remains');
  assert.ok(!idx.includes('CELLS ×'), 'no stale CELLS HUD markup remains');
});
