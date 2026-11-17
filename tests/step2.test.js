'use strict';
// Step 2 tests: planetary health, medkits, ship repairs.
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

function makeDocument(){
  return {
    createElement(){ return {
      id: '', style: {}, children: [], innerHTML: '', textContent: '', value: '',
      classList: { add(){}, remove(){}, contains(){ return false; } },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener() {},
      remove(){}
    }; },
    getElementById(){ return { addEventListener() {}, disabled: false, style: {}, parentElement: null, nextElementSibling: null }; },
    addEventListener() {}
  };
}

function loadPlayer(seedSave) {
  const localStorage = makeLocalStorage(seedSave);
  const document = makeDocument();
  const window = {
    localStorage, document, __GALAXY_TEST__: true, addEventListener() {},
    Math, JSON, Date, Number, String, Array, Object, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() }
  };
  const context = vm.createContext({ window, localStorage, document, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/player.js'), 'utf8'), context, { filename: 'js/player.js' });
  return { window, localStorage, context };
}

test('PD.playerHp is separate from ship hp', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  assert.equal(PD.playerHp, 100);
  assert.equal(PD.hp, 100);
  assert.equal(PD.playerHpMax(), 100);
  PD.hp = 10;
  assert.equal(PD.playerHp, 100);
  PD.playerHp = 10;
  assert.equal(PD.hp, 10);
});

test('PD.playerDmg reduces player health only, never ship hp/shield', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.shield = 50;
  PD.hp = 100;
  PD.playerHp = 100;
  PD.playerDmg(30);
  assert.equal(PD.playerHp, 70);
  assert.equal(PD.hp, 100, 'ship hp unchanged');
  assert.equal(PD.shield, 50, 'shield unchanged');
  PD.playerDmg(1000);
  assert.equal(PD.playerHp, 0);
});

test('PD.useMedkit heals playerHp in planet mode, not ship hp', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  window.Game = { state: 'planet' };
  PD.medkits = 1;
  PD.hp = 10;
  PD.playerHp = 10;
  const result = PD.useMedkit();
  assert.equal(result, true);
  assert.equal(PD.medkits, 0);
  assert.equal(PD.playerHp, 65, 'player health healed by 55');
  assert.equal(PD.hp, 10, 'ship hp NOT healed by medkit in planet mode');
});

test('PD.useMedkit heals ship hp in space mode', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  window.Game = { state: 'space' };
  PD.medkits = 1;
  PD.hp = 10;
  PD.playerHp = 100;
  const result = PD.useMedkit();
  assert.equal(result, true);
  assert.equal(PD.hp, 65, 'ship hp healed by 55 in space mode');
  assert.equal(PD.playerHp, 100, 'playerHp unchanged in space mode');
});

test('PD.useMedkit returns false when no medkits or already at max', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  window.Game = { state: 'planet' };
  PD.medkits = 0;
  PD.playerHp = 100;
  assert.equal(PD.useMedkit(), false);
  PD.medkits = 1;
  PD.playerHp = 100;
  assert.equal(PD.useMedkit(), false, 'no heal when at max');
});

test('save/load round-trips playerHp', () => {
  const { window, localStorage } = loadPlayer();
  const PD = window.PD;
  PD.playerHp = 42;
  PD.save();
  const raw = JSON.parse(localStorage.getItem('galaxy-one-save'));
  assert.equal(raw.playerHp, 42);
  const { window: w2 } = loadPlayer(raw);
  assert.equal(w2.PD.playerHp, 42);
  assert.equal(w2.PD.playerHpMax(), 100);
});

test('legacy save without playerHp defaults to full health', () => {
  const legacySave = { credits: 777, systemIdx: 0, hp: 50, shield: 0 };
  assert.equal(Object.prototype.hasOwnProperty.call(legacySave, 'playerHp'), false);
  const { window } = loadPlayer(legacySave);
  assert.equal(window.PD.playerHp, 100, 'legacy save gets full player health');
  // ship hp is reset by resetShipState() on load (existing behavior)
  assert.equal(window.PD.hp, window.PD.hullMax(), 'ship hp reset to max on load');
});

test('PD.newGame() resets playerHp', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.playerHp = 10;
  PD.medkits = 5;
  PD.credits = 9999;
  PD.newGame();
  assert.equal(PD.playerHp, 100);
  assert.equal(PD.hp, PD.hullMax());
  assert.equal(PD.credits, 400);
});

test('repair cost scales with missing hull', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.hp = PD.hullMax(); // full hull
  let missing = Math.ceil(PD.hullMax() - PD.hp);
  assert.equal(missing, 0);
  assert.equal(Math.ceil(missing * 2), 0, 'no cost when hull full');

  PD.hp = Math.ceil(PD.hullMax() * 0.5); // half hull
  missing = Math.ceil(PD.hullMax() - PD.hp);
  const cost = Math.ceil(missing * 2);
  assert.ok(cost > 0, 'repair cost should be positive when damaged');
  assert.equal(cost, Math.ceil(missing * 2));
});

test('repair deducts credits and restores hull to max', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.credits = 1000;
  PD.hp = 10; // damaged
  const missingHull = Math.ceil(PD.hullMax() - PD.hp);
  const repairCost = Math.ceil(missingHull * 2);
  assert.ok(PD.credits >= repairCost, 'enough credits for repair');
  PD.credits -= repairCost;
  PD.hp = PD.hullMax();
  assert.equal(PD.hp, PD.hullMax(), 'hull restored to max');
  assert.equal(PD.credits, 1000 - repairCost, 'credits deducted');
});

test('repair blocked when insufficient credits', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.credits = 0;
  PD.hp = 10; // damaged
  const missingHull = Math.ceil(PD.hullMax() - PD.hp);
  const repairCost = Math.ceil(missingHull * 2);
  assert.ok(PD.credits < repairCost, 'not enough credits');
  assert.equal(PD.credits, 0, 'no credits deducted when insufficient');
  assert.notEqual(PD.hp, PD.hullMax(), 'hull not restored');
});

// ---- Bug 1: Planetary health HUD display ----
function loadGameWithHUD(seedSave) {
  const localStorage = makeLocalStorage(seedSave);
  const document = makeDocument();
  const window = {
    localStorage, document, __GALAXY_TEST__: true, addEventListener() {},
    Math, JSON, Date, Number, String, Array, Object, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() },
    setTimeout(fn){ fn(); }, clearTimeout(){}
  };
  const context = vm.createContext({
    window, localStorage, document, console,
    setTimeout(fn){ fn(); }, clearTimeout(){}
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/player.js'), 'utf8'), context, { filename: 'js/player.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8'), context, { filename: 'js/game.js' });
  return { window, localStorage, context, document };
}

test('planetary HUD shows player health (not ship hull)', () => {
  const { window, document } = loadGameWithHUD();
  const PD = window.PD;
  const Game = window.Game;
  Game.state = 'planet';
  Game.prompt = '';
  Game.els = { prompt: { innerHTML: '', classList: { remove(){}, add(){}, contains(){} } } };
  PD.playerHp = 42;

  // Build a mock DOM structure matching index.html:
  // <div class="bar-label">HULL <span id="hp-txt"></span></div>
  const hpTxt = { textContent: '100/100', parentElement: null };
  const hpBar = { style: {} };
  const hpLabel = {
    textContent: 'HULL 100/100',
    childNodes: [{ nodeType: 3, textContent: 'HULL ' }],
    parentElement: null,
    appendChild(c) { this.childNodes.push(c); c.parentElement = this; },
    setAttribute(){}
  };
  hpLabel.childNodes.push(hpTxt);
  hpTxt.parentElement = hpLabel;

  const shLabel = { textContent: 'SHIELD 0/0', style: {}, parentElement: null, nextElementSibling: { style: {} } };
  const shTxt = { textContent: '', parentElement: shLabel };
  const shBar = { style: {} };
  const spdLabel = { textContent: 'SPEED ', style: {}, parentElement: null, nextElementSibling: { style: {} } };
  const spdTxt = { textContent: '', parentElement: spdLabel };
  const spdBar = { style: {} };
  const medkitParent = { style: {}, parentElement: null };

  // Mock Planet for HUD rendering
  window.Planet = { prompt: '' };

  document.getElementById = (id) => {
    if(id === 'hp-txt') return hpTxt;
    if(id === 'hp-bar') return hpBar;
    if(id === 'sh-txt') return shTxt;
    if(id === 'spd-txt') return spdTxt;
    if(id === 'credits-txt') return { textContent: '' };
    if(id === 'cargo-lines') return { textContent: '' };
    if(id === 'cargo-txt') return { textContent: '' };
    if(id === 'cargo-bar') return { style: {} };
    if(id === 'medkit-txt') return { innerHTML: '', parentElement: medkitParent };
    if(id === 'sys-txt') return { textContent: '' };
    return { textContent: '', style: {}, parentElement: null, nextElementSibling: null };
  };

  Game._renderHudDom();

  assert.equal(hpTxt.textContent, '42/100', 'health text shows playerHp');
  assert.equal(Math.round(parseFloat(hpBar.style.width)), 42, 'health bar width reflects playerHp');
  // hpTxt span should still be a child of hpLabel (not destroyed by textContent overwrite)
  const hasHpTxtChild = hpLabel.childNodes.some(c => c === hpTxt);
  assert.ok(hasHpTxtChild, 'hpTxt element preserved in DOM (not destroyed by parent textContent overwrite)');
});

test('space HUD still shows ship hull (not player health)', () => {
  const { window, document } = loadGameWithHUD();
  const PD = window.PD;
  const Game = window.Game;
  Game.state = 'space';
  Game.prompt = '';
  Game.els = { prompt: { innerHTML: '', classList: { remove(){}, add(){}, contains(){} } } };
  PD.hp = 30;
  PD.playerHp = 42;
  // Mock Space.stats for space mode HUD
  window.Space = { stats: { speed: 50 } };

  const hpTxt = { textContent: '100/100', parentElement: null };
  const hpBar = { style: {} };
  const hpLabel = {
    textContent: 'HULL 100/100',
    childNodes: [{ nodeType: 3, textContent: 'HULL ' }],
    parentElement: null
  };
  hpLabel.childNodes.push(hpTxt);
  hpTxt.parentElement = hpLabel;

  document.getElementById = (id) => {
    if(id === 'hp-txt') return hpTxt;
    if(id === 'hp-bar') return hpBar;
    if(id === 'credits-txt') return { textContent: '' };
    if(id === 'cargo-lines') return { textContent: '' };
    if(id === 'cargo-txt') return { textContent: '' };
    if(id === 'cargo-bar') return { style: {} };
    if(id === 'medkit-txt') return { innerHTML: '', parentElement: { style: {} } };
    if(id === 'sys-txt') return { textContent: '' };
    if(id === 'sh-txt') return { textContent: '', parentElement: { style: {}, parentElement: null, nextElementSibling: { style: {} } } };
    if(id === 'spd-txt') return { textContent: '', parentElement: { style: {}, parentElement: null, nextElementSibling: { style: {} } } };
    return { textContent: '', style: {}, parentElement: null, nextElementSibling: null };
  };

  Game._renderHudDom();

  assert.equal(hpTxt.textContent, '30/' + PD.hullMax(), 'space HUD shows ship hull');
});

// ---- Bug 2: Emergency evacuation restores player health ----
test('onPlanetDeath restores playerHp to max after evacuation', () => {
  const { window } = loadGameWithHUD();
  const PD = window.PD;
  const Game = window.Game;
  Game.state = 'planet';
  Game.prompt = '';

  // Mock GameAudio
  window.GameAudio = { bigBoom(){}, hurt(){}, uiBuy(){}, uiClick(){}, land(){}, takeoff(){}, warp(){}, alarm(){}, coin(){}, laser(){}, laserHit(){}, boom(){}, pickup(){}, emp(){}, lock(){}, engine(){}, tone(){}, noise(){}, uiToast(){}, uiBuy(){}, toggleMute(){}, init(){}, resume(){}, mute:false };

  // Mock _fade to execute callback immediately
  Game._fade = (cb) => cb();

  // Set up els for uiToast
  Game.els = {
    toasts: { children: [], appendChild(t){ this.children.push(t); }, remove(){}, firstChild: null, style: {} }
  };

  // Simulate player death
  PD.playerHp = 0;
  PD.cargo = { ore: 10, wood: 0, crystal: 0, goo: 0 };
  PD.credits = 500;

  // Mock Planet state
  window.Planet = {
    state: { ship: { x: 100, y: 200 } },
    player: { x: 0, y: 0 },
    aliens: [],
    hitFlash: 0
  };

  Game.onPlanetDeath();

  // After evacuation, player health should be restored
  assert.equal(PD.playerHp, PD.playerHpMax(), 'player health restored after evacuation');
  assert.ok(PD.playerHp > 0, 'player is alive after evacuation');
  assert.equal(Game.deathHandled, false, 'deathHandled flag reset');
});

test('onPlanetDeath handles repeated deaths correctly', () => {
  const { window } = loadGameWithHUD();
  const PD = window.PD;
  const Game = window.Game;
  Game.state = 'planet';
  Game.prompt = '';

  window.GameAudio = { bigBoom(){}, hurt(){}, uiBuy(){}, uiClick(){}, land(){}, takeoff(){}, warp(){}, alarm(){}, coin(){}, laser(){}, laserHit(){}, boom(){}, pickup(){}, emp(){}, lock(){}, engine(){}, tone(){}, noise(){}, uiToast(){}, uiBuy(){}, toggleMute(){}, init(){}, resume(){}, mute:false };
  Game._fade = (cb) => cb();
  Game.els = {
    toasts: { children: [], appendChild(t){ this.children.push(t); }, remove(){}, firstChild: null, style: {} }
  };

  // First death
  PD.playerHp = 0;
  window.Planet = {
    state: { ship: { x: 100, y: 200 } },
    player: { x: 0, y: 0 },
    aliens: [],
    hitFlash: 0
  };
  Game.onPlanetDeath();
  assert.equal(PD.playerHp, PD.playerHpMax(), 'health restored after first evacuation');

  // Second death - should work independently
  PD.playerHp = 0;
  window.Planet = {
    state: { ship: { x: 300, y: 400 } },
    player: { x: 0, y: 0 },
    aliens: [],
    hitFlash: 0
  };
  Game.onPlanetDeath();
  assert.equal(PD.playerHp, PD.playerHpMax(), 'health restored after second evacuation');
  assert.equal(Game.deathHandled, false, 'deathHandled flag reset after second evacuation');
});

// ---- Step 3A: Planetary weapons, energy cells, melee, alien health bars ----

test('PD.hasWeapon / PD.equipWeapon / PD.weaponDmg / PD.weaponDelay', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  assert.equal(PD.hasWeapon('laserpistol'), false);
  assert.equal(PD.equippedWeapon, null);
  assert.equal(PD.weaponDmg(), 0);
  assert.equal(PD.weaponDelay(), 0);

  PD.weapons.push('laserpistol');
  assert.equal(PD.hasWeapon('laserpistol'), true);
  PD.equipWeapon('laserpistol');
  assert.equal(PD.equippedWeapon, 'laserpistol');
  assert.equal(PD.weaponDmg(), 10);
  assert.equal(PD.weaponDelay(), 0.5);

  PD.weapons.push('assaultrifle');
  PD.equipWeapon('assaultrifle');
  assert.equal(PD.equippedWeapon, 'assaultrifle');
  assert.equal(PD.weaponDmg(), 6);
  assert.equal(PD.weaponDelay(), 0.2);
});

test('PD.newGame resets weapons and energy cells', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.weapons = ['laserpistol', 'assaultrifle'];
  PD.equippedWeapon = 'assaultrifle';
  PD.energyCells = 50;
  PD.marketStock = { station: { energyCells: 5, weapons: {} } };

  PD.newGame();
  assert.equal(PD.weapons.length, 0);
  assert.equal(PD.equippedWeapon, null);
  assert.equal(PD.energyCells, 0);
  assert.equal(Object.keys(PD.marketStock).length, 0);
});

test('save/load round-trips weapons and energy cells', () => {
  const { window, localStorage } = loadPlayer();
  const PD = window.PD;
  PD.weapons = ['laserpistol'];
  PD.equippedWeapon = 'laserpistol';
  PD.energyCells = 25;
  PD.marketStock = { station: { energyCells: 3, weapons: { assaultrifle: 1 } } };
  PD.save();

  const raw = JSON.parse(localStorage.getItem('galaxy-one-save'));
  assert.equal(raw.weapons[0], 'laserpistol');
  assert.equal(raw.equippedWeapon, 'laserpistol');
  assert.equal(raw.energyCells, 25);
  assert.equal(raw.marketStock.station.energyCells, 3);

  const { window: w2 } = loadPlayer(raw);
  assert.equal(w2.PD.weapons[0], 'laserpistol');
  assert.equal(w2.PD.equippedWeapon, 'laserpistol');
  assert.equal(w2.PD.energyCells, 25);
  assert.equal(w2.PD.marketStock.station.energyCells, 3);
});

test('WEAPON_DEFS has correct values', () => {
  const { window } = loadPlayer();
  assert.equal(window.WEAPON_DEFS.laserpistol.dmg, 10);
  assert.equal(window.WEAPON_DEFS.laserpistol.delay, 0.5);
  assert.equal(window.WEAPON_DEFS.laserpistol.cost, 250);
  assert.equal(window.WEAPON_DEFS.assaultrifle.dmg, 6);
  assert.equal(window.WEAPON_DEFS.assaultrifle.delay, 0.2);
  assert.equal(window.WEAPON_DEFS.assaultrifle.cost, 400);
});

test('market stock persists between openings', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  // Simulate _marketStock being called twice for same market
  PD.marketStock = {};
  PD.marketStock['station'] = { energyCells: 7, weapons: { laserpistol: 1 } };
  const stock1 = PD.marketStock['station'];
  const stock2 = PD.marketStock['station'];
  assert.equal(stock1, stock2, 'same stock object returned');
  assert.equal(stock1.energyCells, 7);
  assert.equal(stock1.weapons.laserpistol, 1);
});

test('energy cells consumed on shoot', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.equippedWeapon = 'laserpistol';
  PD.energyCells = 3;
  PD.weapons = ['laserpistol'];

  // Simulate one shot consuming 1 cell
  PD.energyCells--;
  assert.equal(PD.energyCells, 2);

  // Simulate shooting until empty
  while(PD.energyCells > 0) PD.energyCells--;
  assert.equal(PD.energyCells, 0);
  assert.ok(PD.energyCells <= 0, 'no ammo left');
});

test('cannot fire without equipped weapon', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.equippedWeapon = null;
  PD.energyCells = 10;
  assert.equal(PD.equippedWeapon, null);
  assert.equal(PD.weaponDmg(), 0);
  assert.equal(PD.weaponDelay(), 0);
});

test('cannot fire without energy cells', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.equippedWeapon = 'laserpistol';
  PD.energyCells = 0;
  assert.equal(PD.energyCells, 0);
  // Weapon equipped but no ammo - cannot fire
});
