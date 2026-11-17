'use strict';
// Stage A smoke tests: star-system identity, authoritative SYSTEMS, derived
// galaxy map, save/load compatibility and unchanged navigation data.
//
// Run with: npm test   (or: node --test)
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');

function makeLocalStorage(seedSave) {
  const data = new Map();
  if (seedSave !== undefined) data.set('galaxy-one-save', JSON.stringify(seedSave));
  return {
    data,
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); }
  };
}

function makeFakeDocument() {
  return {
    createElement() {
      return {
        className: '', innerHTML: '', textContent: '', style: {}, children: [], disabled: false,
        appendChild(child) { this.children.push(child); return child; },
        addEventListener() {}
      };
    }
  };
}

// Load player.js then game.js into one isolated browser-like context. The
// __GALAXY_TEST__ flag prevents game.js from booting WebGL/DOM.
function loadGame(seedSave) {
  const localStorage = makeLocalStorage(seedSave);
  const document = makeFakeDocument();
  const window = {
    localStorage,
    __GALAXY_TEST__: true,
    addEventListener() {}
  };
  const context = vm.createContext({
    window, localStorage, document, console, Math, JSON, Date,
    Number, String, Array, Object, isFinite, parseInt, parseFloat
  });
  for (const file of ['js/player.js', 'js/game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  return { window, localStorage, document, context };
}

const SYSTEM_NAMES = ['ORION REACH', 'KRELL EXPANSE', 'NOVARA SPUR'];
const PLANET_IDS = [
  ['TERRA PRIME', 0], ['VERDANT', 0],
  ['KRELL PRIME', 1], ['ASHFALL', 1],
  ['NOVARA', 2], ['UMBRA', 2]
];
const STATION_IDS = [
  ['ORION STATION', 0], ['KRELL DEPOT', 1], ['NOVARA GATE', 2]
];

test('all nine existing bodies and stations have the correct system assignment', () => {
  const { window } = loadGame();
  assert.equal(window.PLANETS.length, 6);
  assert.equal(window.STATIONS.length, 3);

  window.PLANETS.forEach((p, i) => {
    assert.equal(p.name, PLANET_IDS[i][0], 'planet ' + i + ' name preserved');
    assert.equal(p.sys, PLANET_IDS[i][1], 'planet ' + i + ' system');
  });
  window.STATIONS.forEach((s, i) => {
    assert.equal(s.name, STATION_IDS[i][0], 'station ' + i + ' name preserved');
    assert.equal(s.sys, STATION_IDS[i][1], 'station ' + i + ' system');
  });

  // Helper used by the game to identify a body's system.
  assert.equal(window.PD.systemOf('planet', 0), 0);
  assert.equal(window.PD.systemOf('planet', 3), 1);
  assert.equal(window.PD.systemOf('planet', 5), 2);
  assert.equal(window.PD.systemOf('station', 0), 0);
  assert.equal(window.PD.systemOf('station', 1), 1);
  assert.equal(window.PD.systemOf('station', 2), 2);
});

test('SYSTEMS is the single authoritative source of system data', () => {
  const { window } = loadGame();
  const SYSTEMS = window.SYSTEMS;
  assert.equal(SYSTEMS.length, 3);
  assert.deepEqual(SYSTEMS.map(s => s.name), SYSTEM_NAMES);

  // Every body named by SYSTEMS resolves to exactly that system.
  SYSTEMS.forEach((sys, si) => {
    assert.equal(sys.idx, si);
    const hub = window.STATIONS[sys.hub];
    assert.ok(hub, 'hub station exists');
    assert.equal(hub.sys, si);
    for (const pi of sys.planets) {
      const planet = window.PLANETS[pi];
      assert.ok(planet, 'planet index exists');
      assert.equal(planet.sys, si);
      assert.equal(planet.name, PLANET_IDS[pi][0]);
    }
  });

  // No planet or station is unassigned, and the nine bodies are unique.
  const all = window.PLANETS.map((p, i) => ({ kind: 'planet', idx: i, sys: p.sys }))
    .concat(window.STATIONS.map((s, i) => ({ kind: 'station', idx: i, sys: s.sys })));
  assert.equal(all.length, 9);
  for (const b of all) assert.ok(Number.isInteger(b.sys), b.kind + ' ' + b.idx + ' has a system index');
  const keys = new Set(all.map(b => b.kind + ':' + b.idx));
  assert.equal(keys.size, 9);
});

test('Game.GALAXY is correctly derived from SYSTEMS', () => {
  const { window } = loadGame();
  const galaxy = window.Game.GALAXY;

  assert.equal(galaxy.length, 3);
  assert.deepEqual(galaxy.map(s => s.name), SYSTEM_NAMES);
  assert.deepEqual(galaxy.map(s => s.bodies), [
    [{ kind: 'station', idx: 0 }, { kind: 'planet', idx: 0 }, { kind: 'planet', idx: 1 }],
    [{ kind: 'station', idx: 1 }, { kind: 'planet', idx: 2 }, { kind: 'planet', idx: 3 }],
    [{ kind: 'station', idx: 2 }, { kind: 'planet', idx: 4 }, { kind: 'planet', idx: 5 }]
  ]);
  assert.equal(galaxy.reduce((n, s) => n + s.bodies.length, 0), 9);
  assert.deepEqual(window.Game.GALAXY, window.buildGalaxy());
});

test('Game.GALAXY is a live view of SYSTEMS, not a duplicated table', () => {
  const { window } = loadGame();
  const original = window.SYSTEMS[0].name;
  window.SYSTEMS[0].name = 'ORION REACH TEST';
  try {
    assert.equal(window.Game.GALAXY[0].name, 'ORION REACH TEST');
  } finally {
    window.SYSTEMS[0].name = original;
  }
  assert.equal(window.Game.GALAXY[0].name, original);
});

test('old saves without systemIdx load into ORION REACH', () => {
  // A save shape from before Stage A: no systemIdx field at all.
  const legacySave = {
    credits: 777, medkits: 2,
    cargo: { ore: 3, wood: 0, crystal: 0, goo: 0 },
    trade: { food: 0, tech: 0, med: 0, lux: 0 },
    up: { weapon: 2, engine: 1, hull: 1, shield: 1, scanner: 1 },
    installed: [], modules: [], missions: [], missionsDone: 4
  };
  assert.equal(Object.prototype.hasOwnProperty.call(legacySave, 'systemIdx'), false);
  const { window } = loadGame(legacySave);
  assert.equal(window.PD.systemIdx, 0);
  assert.equal(window.PD.systemName(window.PD.systemIdx), 'ORION REACH');
  // Existing legacy fields still load normally.
  assert.equal(window.PD.credits, 777);
  assert.equal(window.PD.missionsDone, 4);
});

test('save/load round-trips systemIdx and rejects out-of-range values', () => {
  const { window, localStorage } = loadGame();
  window.PD.systemIdx = 2;
  window.PD.save();

  const raw = JSON.parse(localStorage.getItem('galaxy-one-save'));
  assert.equal(raw.systemIdx, 2);

  const reloaded = loadGame(raw);
  assert.equal(reloaded.window.PD.systemIdx, 2);
  assert.equal(reloaded.window.PD.systemName(2), 'NOVARA SPUR');

  for (const bad of [99, -1, null]) {
    const badLoad = loadGame({ credits: 1, systemIdx: bad });
    assert.equal(badLoad.window.PD.systemIdx, 0, 'bad systemIdx ' + bad + ' falls back to ORION REACH');
  }
});

test('navigation data and existing gameplay identifiers are unchanged', () => {
  const { window } = loadGame();

  // Exact coordinates, sizes, types and order are preserved (no new bodies,
  // no moved bodies, no changed station positions).
  assert.deepEqual(window.PLANETS.map(p => [p.name, p.x, p.y, p.z, p.size, p.type]), [
    ['TERRA PRIME', 420, 60, -900, 110, 'peaceful'],
    ['VERDANT', -1400, -120, 500, 90, 'mixed'],
    ['KRELL PRIME', 1500, 200, 1400, 120, 'hostile'],
    ['ASHFALL', -900, 320, -1700, 100, 'hostile'],
    ['NOVARA', 2200, -250, -1900, 95, 'peaceful'],
    ['UMBRA', -2300, 420, 1500, 105, 'hostile']
  ]);
  assert.deepEqual(window.STATIONS.map(s => [s.key, s.name, s.pos]), [
    ['station', 'ORION STATION', [0, 0, 0]],
    ['depot', 'KRELL DEPOT', [1150, -100, 1050]],
    ['gate', 'NOVARA GATE', [1900, -150, -1600]]
  ]);

  // Existing progression formulas still behave as before.
  const PD = window.PD;
  assert.equal(PD.hullMax(), 100);
  assert.equal(PD.cargoMax(), 50);
  assert.equal(PD.laserDmg(), 14);
  assert.equal(PD.scannerLockTime(), 3);
});

test('galaxy map body info resolves station system names (regression: old st.system field)', () => {
  const { window } = loadGame();
  const station = window.Game._bodyInfo({ kind: 'station', idx: 1 });
  assert.equal(station.name, 'KRELL DEPOT');
  assert.equal(station.sub, 'KRELL EXPANSE');
  const planet = window.Game._bodyInfo({ kind: 'planet', idx: 5 });
  assert.equal(planet.name, 'UMBRA');
  assert.match(planet.sub, /HOSTILE/);
});

test('galaxy map presentation marks the current system', () => {
  const { window, document } = loadGame();
  window.Space = { ship: { position: { x: 0, y: 0, z: 0 } } };

  function renderAt(systemIdx) {
    const menu = document.createElement('div');
    window.Game.els = { menuInner: menu };
    window.PD.systemIdx = systemIdx;
    window.Game._renderGalaxy();
    return menu;
  }

  const orion = renderAt(0);
  assert.match(orion.innerHTML, /CURRENT SYSTEM · ORION REACH/);
  const orionText = orion.children.map(c => c.innerHTML || c.textContent || '').join('\n');
  assert.match(orionText, /ORION REACH ◀ CURRENT/);
  assert.doesNotMatch(orionText, /KRELL EXPANSE ◀ CURRENT/);

  const novara = renderAt(2);
  assert.match(novara.innerHTML, /CURRENT SYSTEM · NOVARA SPUR/);
  const novaraText = novara.children.map(c => c.innerHTML || c.textContent || '').join('\n');
  assert.match(novaraText, /NOVARA SPUR ◀ CURRENT/);
});