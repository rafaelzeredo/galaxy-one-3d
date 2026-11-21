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

  const hpTxt = { textContent: '100/100', parentElement: null };
  const hpBar = { style: {} };
  const hpLabel = {
    textContent: 'HULL 100/100',
    childNodes: [{ nodeType: 3, textContent: 'HULL ' }],
    parentElement: null,
    appendChild(c) { this.children.push(c); c.parentElement = this; },
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

  window.GameAudio = { bigBoom(){}, hurt(){}, uiBuy(){}, uiClick(){}, land(){}, takeoff(){}, warp(){}, alarm(){}, coin(){}, laser(){}, laserHit(){}, boom(){}, pickup(){}, emp(){}, lock(){}, engine(){}, tone(){}, noise(){}, uiToast(){}, uiBuy(){}, toggleMute(){}, init(){}, resume(){}, mute:false };
  Game._fade = (cb) => cb();
  Game.els = {
    toasts: { children: [], appendChild(t){ this.children.push(t); }, remove(){}, firstChild: null, style: {} },
    gameover: { classList: { add(){}, remove(){} } },
    hud: { classList: { add(){}, remove(){} } },
    cross: { classList: { add(){}, remove(){} } },
    space: { classList: { add(){}, remove(){} } }
  };

  PD.playerHp = 0;
  PD.cargo = { ore: 10, wood: 0, crystal: 0, goo: 0 };
  PD.credits = 500;

  window.Planet = {
    state: { ship: { x: 100, y: 200 } },
    player: { x: 0, y: 0 },
    aliens: [],
    hitFlash: 0
  };

  Game.onPlanetDeath();

  assert.ok(Game.state === 'gameover' || PD.playerHp === 0, 'player dies and triggers game over');
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
    toasts: { children: [], appendChild(t){ this.children.push(t); }, remove(){}, firstChild: null, style: {} },
    gameover: { classList: { add(){}, remove(){} } },
    hud: { classList: { add(){}, remove(){} } },
    cross: { classList: { add(){}, remove(){} } },
    space: { classList: { add(){}, remove(){} } }
  };

  PD.playerHp = 0;
  window.Planet = {
    state: { ship: { x: 100, y: 200 } },
    player: { x: 0, y: 0 },
    aliens: [],
    hitFlash: 0
  };
  Game.onPlanetDeath();
  assert.ok(Game.state === 'gameover', 'game over triggered after first death');

  PD.playerHp = 0;
  window.Planet = {
    state: { ship: { x: 300, y: 400 } },
    player: { x: 0, y: 0 },
    aliens: [],
    hitFlash: 0
  };
  // second death after game over - should not crash
  Game.deathHandled = false;
  Game.onPlanetDeath();
  assert.ok(Game.state === 'gameover', 'game over state persists');
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

  PD.energyCells--;
  assert.equal(PD.energyCells, 2);

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

// ---- Step 3A Fix: Weapon switching, HUD icons, selling weapons/ammo ----

test('PD.sellWeapon removes owned weapon and refunds credits', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.weapons = ['laserpistol', 'assaultrifle'];
  PD.equippedWeapon = 'laserpistol';
  PD.credits = 100;
  const refund = PD.sellWeapon('laserpistol');
  assert.equal(refund, Math.round(250 * 0.6), 'refund is 60% of cost');
  assert.equal(PD.credits, 100 + refund, 'credits increased by refund');
  assert.equal(PD.hasWeapon('laserpistol'), false, 'weapon no longer owned');
  assert.equal(PD.equippedWeapon, 'assaultrifle', 're-equipped remaining weapon');
});

test('PD.sellWeapon returns 0 for unowned weapon', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.credits = 100;
  const refund = PD.sellWeapon('laserpistol');
  assert.equal(refund, 0, 'no refund for unowned weapon');
  assert.equal(PD.credits, 100, 'credits unchanged');
});

test('PD.sellWeapon selling last weapon keeps equippedWeapon null', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.weapons = ['laserpistol'];
  PD.equippedWeapon = 'laserpistol';
  PD.credits = 100;
  const refund = PD.sellWeapon('laserpistol');
  assert.equal(PD.hasWeapon('laserpistol'), false);
  assert.equal(PD.equippedWeapon, null, 'no equipped weapon when none owned');
  assert.equal(PD.weaponDmg(), 0, 'no weapon damage');
});

test('PD.sellEnergyCells deducts cells and refunds', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.energyCells = 10;
  PD.credits = 100;
  const refund = PD.sellEnergyCells(3);
  assert.equal(refund, Math.round(25 * 0.9 * 3), 'refund for 3 cells');
  assert.equal(PD.energyCells, 7, 'cells deducted');
  assert.equal(PD.credits, 100 + refund, 'credits increased');
});

test('PD.sellEnergyCells caps at owned amount', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.energyCells = 2;
  PD.credits = 100;
  const refund = PD.sellEnergyCells(100);
  assert.equal(refund, Math.round(25 * 0.9 * 2), 'only sells owned cells');
  assert.equal(PD.energyCells, 0, 'all cells sold');
});

test('PD.sellEnergyCells returns 0 when no cells', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.energyCells = 0;
  PD.credits = 100;
  const refund = PD.sellEnergyCells(5);
  assert.equal(refund, 0, 'no refund when no cells');
  assert.equal(PD.credits, 100, 'credits unchanged');
});

test('G key switches between owned weapons', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.weapons = ['laserpistol', 'assaultrifle'];
  PD.equippedWeapon = 'laserpistol';
  const idx = PD.weapons.indexOf(PD.equippedWeapon);
  const next = PD.weapons[(idx + 1) % PD.weapons.length];
  PD.equipWeapon(next);
  assert.equal(PD.equippedWeapon, 'assaultrifle', 'switched to assault rifle');
  const idx2 = PD.weapons.indexOf(PD.equippedWeapon);
  const next2 = PD.weapons[(idx2 + 1) % PD.weapons.length];
  PD.equipWeapon(next2);
  assert.equal(PD.equippedWeapon, 'laserpistol', 'switched back to laser pistol');
});

test('G key switching does not consume energy cells', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.weapons = ['laserpistol', 'assaultrifle'];
  PD.equippedWeapon = 'laserpistol';
  PD.energyCells = 5;
  const before = PD.energyCells;
  PD.equipWeapon('assaultrifle');
  PD.equipWeapon('laserpistol');
  assert.equal(PD.energyCells, before, 'energy cells unchanged after switching');
});

test('single weapon remains selected without G switch needed', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.weapons = ['laserpistol'];
  PD.equippedWeapon = 'laserpistol';
  PD.equipWeapon('laserpistol');
  assert.equal(PD.equippedWeapon, 'laserpistol');
  assert.equal(PD.weapons.length, 1);
});

test('melee remains available after selling last weapon', () => {
  const { window } = loadPlayer();
  const PD = window.PD;
  PD.weapons = ['laserpistol'];
  PD.equippedWeapon = 'laserpistol';
  PD.sellWeapon('laserpistol');
  assert.equal(PD.equippedWeapon, null, 'no weapon equipped');
  assert.equal(PD.weaponDmg(), 0, 'no weapon damage');
  PD.playerHp = 100;
  PD.playerDmg(10);
  assert.equal(PD.playerHp, 90, 'player can still take melee damage');
});

test('weapon HUD shows icon and name when equipped', () => {
  const { window, document } = loadGameWithHUD();
  const PD = window.PD;
  const Game = window.Game;
  Game.state = 'planet';
  Game.prompt = '';
  window.Planet = { prompt: '' };
  Game.els = { prompt: { innerHTML: '', classList: { remove(){}, add(){}, contains(){} } } };
  PD.equippedWeapon = 'laserpistol';
  PD.energyCells = 10;
  const wepEl = { innerHTML: '', parentElement: { style: {} } };
  document.getElementById = (id) => {
    if(id === 'wep-txt') return wepEl;
    if(id === 'hp-txt') return { textContent: '', parentElement: { childNodes: [] } };
    if(id === 'hp-bar') return { style: {} };
    if(id === 'sh-txt') return { textContent: '', parentElement: { style: {}, nextElementSibling: { style: {} } } };
    if(id === 'spd-txt') return { textContent: '', parentElement: { style: {}, nextElementSibling: { style: {} } } };
    if(id === 'credits-txt') return { textContent: '' };
    if(id === 'cargo-lines') return { textContent: '' };
    if(id === 'cargo-txt') return { textContent: '' };
    if(id === 'cargo-bar') return { style: {} };
    if(id === 'medkit-txt') return { innerHTML: '', parentElement: { style: {} } };
    if(id === 'sys-txt') return { textContent: '' };
    return { textContent: '', style: {}, parentElement: null, nextElementSibling: null };
  };
  Game._renderHudDom();
  assert.ok(wepEl.innerHTML.includes('Laser Pistol'), 'shows laser pistol name');
  assert.ok(wepEl.innerHTML.includes('PULSE ROUNDS ×10'), 'shows energy cell count');
  assert.ok(wepEl.innerHTML.includes('⚬|'), 'shows pistol icon');
});

test('weapon HUD shows assault rifle icon when equipped', () => {
  const { window, document } = loadGameWithHUD();
  const PD = window.PD;
  const Game = window.Game;
  Game.state = 'planet';
  Game.prompt = '';
  window.Planet = { prompt: '' };
  Game.els = { prompt: { innerHTML: '', classList: { remove(){}, add(){}, contains(){} } } };
  PD.equippedWeapon = 'assaultrifle';
  PD.energyCells = 3;
  const wepEl = { innerHTML: '', parentElement: { style: {} } };
  document.getElementById = (id) => {
    if(id === 'wep-txt') return wepEl;
    if(id === 'hp-txt') return { textContent: '', parentElement: { childNodes: [] } };
    if(id === 'hp-bar') return { style: {} };
    if(id === 'sh-txt') return { textContent: '', parentElement: { style: {}, nextElementSibling: { style: {} } } };
    if(id === 'spd-txt') return { textContent: '', parentElement: { style: {}, nextElementSibling: { style: {} } } };
    if(id === 'credits-txt') return { textContent: '' };
    if(id === 'cargo-lines') return { textContent: '' };
    if(id === 'cargo-txt') return { textContent: '' };
    if(id === 'cargo-bar') return { style: {} };
    if(id === 'medkit-txt') return { innerHTML: '', parentElement: { style: {} } };
    if(id === 'sys-txt') return { textContent: '' };
    return { textContent: '', style: {}, parentElement: null, nextElementSibling: null };
  };
  Game._renderHudDom();
  assert.ok(wepEl.innerHTML.includes('Assault Rifle'), 'shows assault rifle name');
  assert.ok(wepEl.innerHTML.includes('⚬|='), 'shows rifle icon');
  assert.ok(wepEl.innerHTML.includes('PULSE ROUNDS ×3'), 'shows energy cell count');
});

test('weapon HUD shows G switch hint when both weapons owned', () => {
  const { window, document } = loadGameWithHUD();
  const PD = window.PD;
  const Game = window.Game;
  Game.state = 'planet';
  Game.prompt = '';
  window.Planet = { prompt: '' };
  Game.els = { prompt: { innerHTML: '', classList: { remove(){}, add(){}, contains(){} } } };
  PD.equippedWeapon = 'laserpistol';
  PD.weapons = ['laserpistol', 'assaultrifle'];
  PD.energyCells = 5;
  const wepEl = { innerHTML: '', parentElement: { style: {} } };
  document.getElementById = (id) => {
    if(id === 'wep-txt') return wepEl;
    if(id === 'hp-txt') return { textContent: '', parentElement: { childNodes: [] } };
    if(id === 'hp-bar') return { style: {} };
    if(id === 'sh-txt') return { textContent: '', parentElement: { style: {}, nextElementSibling: { style: {} } } };
    if(id === 'spd-txt') return { textContent: '', parentElement: { style: {}, nextElementSibling: { style: {} } } };
    if(id === 'credits-txt') return { textContent: '' };
    if(id === 'cargo-lines') return { textContent: '' };
    if(id === 'cargo-txt') return { textContent: '' };
    if(id === 'cargo-bar') return { style: {} };
    if(id === 'medkit-txt') return { innerHTML: '', parentElement: { style: {} } };
    if(id === 'sys-txt') return { textContent: '' };
    return { textContent: '', style: {}, parentElement: null, nextElementSibling: null };
  };
  Game._renderHudDom();
  assert.ok(wepEl.innerHTML.includes('[G] switch'), 'shows G switch hint when both owned');
});

test('weapon HUD hides G switch hint when only one weapon owned', () => {
  const { window, document } = loadGameWithHUD();
  const PD = window.PD;
  const Game = window.Game;
  Game.state = 'planet';
  Game.prompt = '';
  window.Planet = { prompt: '' };
  Game.els = { prompt: { innerHTML: '', classList: { remove(){}, add(){}, contains(){} } } };
  PD.equippedWeapon = 'laserpistol';
  PD.weapons = ['laserpistol'];
  PD.energyCells = 5;
  const wepEl = { innerHTML: '', parentElement: { style: {} } };
  document.getElementById = (id) => {
    if(id === 'wep-txt') return wepEl;
    if(id === 'hp-txt') return { textContent: '', parentElement: { childNodes: [] } };
    if(id === 'hp-bar') return { style: {} };
    if(id === 'sh-txt') return { textContent: '', parentElement: { style: {}, nextElementSibling: { style: {} } } };
    if(id === 'spd-txt') return { textContent: '', parentElement: { style: {}, nextElementSibling: { style: {} } } };
    if(id === 'credits-txt') return { textContent: '' };
    if(id === 'cargo-lines') return { textContent: '' };
    if(id === 'cargo-txt') return { textContent: '' };
    if(id === 'cargo-bar') return { style: {} };
    if(id === 'medkit-txt') return { innerHTML: '', parentElement: { style: {} } };
    if(id === 'sys-txt') return { textContent: '' };
    return { textContent: '', style: {}, parentElement: null, nextElementSibling: null };
  };
  Game._renderHudDom();
  assert.ok(!wepEl.innerHTML.includes('[G] switch'), 'hides G switch hint with one weapon');
});

// ---- Step 3B: Planetary combat accuracy, movement, recoil, weapon firing ----

function loadPlanet(seedSave) {
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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/planet2d.js'), 'utf8'), context, { filename: 'js/planet2d.js' });
  return { window, localStorage, context, document };
}

test('WEAPON_DEFS has accuracy, recoil, and range values', () => {
  const { window } = loadPlayer();
  const wd = window.WEAPON_DEFS;
  assert.ok(wd.laserpistol.recoilPerShot > wd.assaultrifle.recoilPerShot,
    'laserpistol has higher recoil per shot than assaultrifle');
  assert.ok(wd.laserpistol.delay > wd.assaultrifle.delay,
    'laserpistol has slower firing rate than assaultrifle');
  assert.ok(wd.laserpistol.range < wd.assaultrifle.range,
    'laserpistol has shorter range than assaultrifle');
  assert.ok(wd.laserpistol.baseSpread > wd.assaultrifle.baseSpread,
    'laserpistol has worse baseline accuracy than assaultrifle');
  assert.ok(wd.laserpistol.maxRecoil > 0, 'laserpistol has maxRecoil defined');
  assert.ok(wd.assaultrifle.maxRecoil > 0, 'assaultrifle has maxRecoil defined');
  assert.ok(wd.laserpistol.recoilRecovery > 0, 'laserpistol has recoilRecovery defined');
  assert.ok(wd.assaultrifle.recoilRecovery > 0, 'assaultrifle has recoilRecovery defined');
});

test('recoil accumulates per shot and is capped at maxRecoil', () => {
  const { window } = loadPlanet();
  const PD = window.PD;
  const PL = window.Planet;
  PL.init({ width: 800, height: 600, getContext(){ return {}; } });
  PD.equippedWeapon = 'laserpistol';
  PD.weapons = ['laserpistol'];
  PD.energyCells = 100;

  let recoil = 0;
  const w = window.WEAPON_DEFS.laserpistol;
  for(let i = 0; i < 10; i++) {
    recoil = Math.min(w.maxRecoil, recoil + w.recoilPerShot);
  }
  assert.ok(recoil > 0, 'recoil accumulates with shots');
  assert.ok(recoil <= w.maxRecoil, 'recoil capped at maxRecoil');
  assert.ok(recoil === w.maxRecoil, 'recoil reaches max after enough shots');
});

test('recoil recovers over time when not firing', () => {
  const { window } = loadPlanet();
  const PD = window.PD;
  const PL = window.Planet;
  PL.init({ width: 800, height: 600, getContext(){ return {}; } });
  PD.equippedWeapon = 'laserpistol';
  PD.weapons = ['laserpistol'];
  PD.energyCells = 100;
  const w = window.WEAPON_DEFS.laserpistol;

  let recoil = w.maxRecoil;
  for(let i = 0; i < 100; i++) {
    recoil = Math.max(0, recoil - 0.1 * w.recoilRecovery);
  }
  assert.ok(recoil < w.maxRecoil, 'recoil recovers over time');
  assert.ok(recoil >= 0, 'recoil never goes negative');
});

test('recoil recovers even while moving', () => {
  const { window } = loadPlanet();
  const PD = window.PD;
  const PL = window.Planet;
  PL.init({ width: 800, height: 600, getContext(){ return {}; } });
  PD.equippedWeapon = 'laserpistol';
  PD.weapons = ['laserpistol'];
  PD.energyCells = 100;
  const w = window.WEAPON_DEFS.laserpistol;

  PL.moving = true;
  let recoil = w.maxRecoil;
  for(let i = 0; i < 100; i++) {
    recoil = Math.max(0, recoil - 0.1 * w.recoilRecovery);
  }
  assert.ok(recoil < w.maxRecoil, 'recoil recovers while moving');
});

test('movement spread adds to total spread when running', () => {
  const { window } = loadPlanet();
  const PD = window.PD;
  const w = window.WEAPON_DEFS.laserpistol;
  const MOVEMENT_SPREAD = 0.06;

  const standingSpread = w.baseSpread + 0;
  const runningSpread = w.baseSpread + MOVEMENT_SPREAD;
  assert.ok(runningSpread > standingSpread, 'running has higher spread than standing');
});

test('both weapons have bounded max recoil and full recovery', () => {
  const { window } = loadPlayer();
  const lp = window.WEAPON_DEFS.laserpistol;
  const ar = window.WEAPON_DEFS.assaultrifle;
  assert.ok(lp.maxRecoil > 0 && lp.maxRecoil < 1, 'laserpistol has bounded max recoil');
  assert.ok(ar.maxRecoil > 0 && ar.maxRecoil < 1, 'assaultrifle has bounded max recoil');
  assert.ok(lp.recoilRecovery > 0, 'laserpistol has recoil recovery rate');
  assert.ok(ar.recoilRecovery > 0, 'assaultrifle has recoil recovery rate');

  let recoil = lp.maxRecoil;
  for(let i = 0; i < 10000; i++){ recoil = Math.max(0, recoil - 0.1 * lp.recoilRecovery); }
  assert.equal(recoil, 0, 'laserpistol recoil fully recovers over time');

  recoil = ar.maxRecoil;
  for(let i = 0; i < 10000; i++){ recoil = Math.max(0, recoil - 0.1 * ar.recoilRecovery); }
  assert.equal(recoil, 0, 'assaultrifle recoil fully recovers over time');
});

test('laserpistol vs assaultrifle weapon characteristics', () => {
  const { window } = loadPlayer();
  const lp = window.WEAPON_DEFS.laserpistol;
  const ar = window.WEAPON_DEFS.assaultrifle;

  // Laser Pistol: slower firing, higher recoil per shot, shorter range, slightly worse baseline accuracy
  assert.ok(lp.delay > ar.delay, 'laserpistol has slower firing rate');
  assert.ok(lp.recoilPerShot > ar.recoilPerShot, 'laserpistol has higher recoil per shot');
  assert.ok(lp.range < ar.range, 'laserpistol has shorter effective range');
  assert.ok(lp.baseSpread > ar.baseSpread, 'laserpistol has worse baseline accuracy');

  // Assault Rifle: faster firing, lower recoil per shot, longer range, better baseline accuracy
  assert.ok(ar.delay < lp.delay, 'assaultrifle has faster firing rate');
  assert.ok(ar.recoilPerShot < lp.recoilPerShot, 'assaultrifle has lower recoil per shot');
  assert.ok(ar.range > lp.range, 'assaultrifle has longer effective range');
  assert.ok(ar.baseSpread < lp.baseSpread, 'assaultrifle has better baseline accuracy');
});