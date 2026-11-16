(function(){
  'use strict';
  // Shared persistent player state: credits, cargo, upgrades, hull, shield.
  const SAVE_KEY = 'galaxy-one-save';

  const COMMS = {
    ore:     { name: 'Iron Ore',      base: 12 },
    wood:    { name: 'Hardwood',      base: 9  },
    crystal: { name: 'Krell Crystal', base: 34 },
    goo:     { name: 'Alien Goo',     base: 18 }
  };

  // Galactic commodity market: same good, wildly different prices per location.
  // Buy low, sell high — the heart of the trading loop.
  const TRADE_GOODS = {
    food: { name: 'Food Rations', base: 20 },
    tech: { name: 'Tech Modules', base: 55 },
    med:  { name: 'Med Supplies', base: 40 },
    lux:  { name: 'Luxury Goods', base: 90 }
  };
  const TRADE_MARKETS = {
    station: { food: 1.00, tech: 1.15, med: 0.95, lux: 1.10 },
    p0:      { food: 0.55, tech: 1.45, med: 1.05, lux: 1.50 },
    p1:      { food: 0.85, tech: 1.10, med: 1.15, lux: 1.25 },
    p2:      { food: 1.70, tech: 0.70, med: 0.80, lux: 0.60 },
    p3:      { food: 1.50, tech: 0.80, med: 1.30, lux: 0.70 },
    p4:      { food: 0.70, tech: 0.85, med: 1.20, lux: 1.35 },
    p5:      { food: 1.60, tech: 0.75, med: 0.85, lux: 0.65 }
  };
  const MARKET_NAMES = {
    station: 'Orion', depot: 'Krell Depot', gate: 'Novara Gate',
    p0: 'Terra', p1: 'Verdant', p2: 'Krell', p3: 'Ashfall', p4: 'Novara', p5: 'Umbra'
  };
  // Ship equipment modules: buy at stations, install into 3 slots, spares are
  // stored in a limited module hold. Effects read via PD.installed.
  const MODULE_DEFS = {
    cargo:     { name: 'Cargo Pod',        desc: '+20 hold capacity',      cost: 350 },
    retrieval: { name: 'Retrieval Beam',   desc: 'huge ore magnet radius', cost: 280 },
    passenger: { name: 'Passenger Module', desc: 'unlocks ferry missions', cost: 320 },
    emp:       { name: 'EMP Emitter',      desc: 'non-lethal pirate disable [F]', cost: 480 },
    weapon:    { name: 'Turret Array',     desc: '+6 laser damage',        cost: 520 }
  };
  const MODULE_SLOTS = 3;
  const MODULE_STORE_CAP = 5;

  const PLANETS = [
    { name: 'TERRA PRIME', type: 'peaceful', color: 0x4d8fe0, size: 110,
      x: 420,  y: 60,  z: -900,  seed: 11, alienRate: 0.25, treeN: 90, crystalN: 8,
      rockN: 30, trader: true, desc: 'Trade hub · wood' },
    { name: 'VERDANT', type: 'mixed', color: 0x3fae72, size: 90,
      x: -1400, y: -120, z: 500, seed: 23, alienRate: 0.7, treeN: 110, crystalN: 22,
      rockN: 46, trader: true, desc: 'Wood + crystals · some aliens' },
    { name: 'KRELL PRIME', type: 'hostile', color: 0x8a3fd0, size: 120,
      x: 1500, y: 200, z: 1400, seed: 37, alienRate: 1.6, treeN: 40, crystalN: 46,
      rockN: 30, trader: false, desc: 'Crystal-rich · swarms' },
    { name: 'ASHFALL', type: 'hostile', color: 0xd0613f, size: 100,
      x: -900, y: 320, z: -1700, seed: 51, alienRate: 1.9, treeN: 14, crystalN: 24,
      rockN: 70, trader: false, desc: 'Rich ore · spitters' },
    { name: 'NOVARA', type: 'peaceful', color: 0x53c8b8, size: 95,
      x: 2200, y: -250, z: -1900, seed: 67, alienRate: 0.35, treeN: 95, crystalN: 14,
      rockN: 40, trader: true, desc: 'Second haven · tech trade' },
    { name: 'UMBRA', type: 'hostile', color: 0x4a5a3a, size: 105,
      x: -2300, y: 420, z: 1500, seed: 83, alienRate: 1.7, treeN: 30, crystalN: 38,
      rockN: 55, trader: false, desc: 'Dark groves · crystal veins' }
  ];

  // Star systems shown on the galaxy map (Tab): each station anchors a system.
  const STATIONS = [
    { key: 'station', name: 'ORION STATION', pos: [0, 0, 0], system: 'ORION REACH' },
    { key: 'depot',   name: 'KRELL DEPOT',   pos: [1150, -100, 1050], system: 'KRELL EXPANSE' },
    { key: 'gate',    name: 'NOVARA GATE',   pos: [1900, -150, -1600], system: 'NOVARA SPUR' }
  ];

  const P = {
    hp: 100, shield: 0, credits: 400, medkits: 1,
    cargo: { ore: 0, wood: 0, crystal: 0, goo: 0 },
    trade: { food: 0, tech: 0, med: 0, lux: 0 },
    up: { weapon: 1, engine: 1, hull: 1, shield: 1, scanner: 1 },
    installed: [],        // module keys in the 3 equipment slots
    modules: [],          // owned but uninstalled (module hold, capped)
    missions: [],         // active missions
    missionsDone: 0,
    rates: null,          // procedural market rates (rerolled per visit)
    spaceSaved: null,           // ship pos/quat while landed
    planetIndex: 0,
    alive: true,

    hullMax(){ return 60 + this.up.hull * 40; },
    shieldMax(){ return this.up.shield >= 2 ? (this.up.shield - 1) * 35 : 0; },
    laserDmg(){ return 8 + this.up.weapon * 6 + (this.installed.indexOf('weapon') >= 0 ? 6 : 0); },
    fireDelay(){ return Math.max(0.09, 0.3 - this.up.weapon * 0.04); },
    thrust(){ return 34 + this.up.engine * 16; },
    maxSpeed(){ return 70 + this.up.engine * 26; },
    // Target scanner: L1 = 3.0s to lock, each level shaves it down to 0.5s at L5.
    scannerLockTime(){ return Math.max(0.5, 3 - (this.up.scanner - 1) * 0.625); },
    cargoMax(){ return 40 + this.up.hull * 10 + this.installed.filter(m => m === 'cargo').length * 20; },
    cargoUsed(){
      let n = 0;
      for(const k in this.cargo) n += this.cargo[k];
      for(const k in this.trade) n += this.trade[k];
      return n;
    },
    scoopRadius(){ return this.installed.indexOf('retrieval') >= 0 ? 95 : 26; },
    hasModule(k){ return this.installed.indexOf(k) >= 0; },
    hasModuleStored(k){ return this.modules.indexOf(k) >= 0; },

    // ---- procedural economy: market rates reshuffle every visit ----
    // Base template biases the spread (routes still exist) but each reroll
    // jitters every market ±15%, so no two visits price the same.
    rollMarkets(){
      this.rates = {};
      for(const mk in TRADE_MARKETS){
        this.rates[mk] = {};
        for(const g in TRADE_MARKETS[mk]){
          this.rates[mk][g] = Math.round(TRADE_MARKETS[mk][g] * (88 + Math.random() * 24)) / 100;
        }
      }
    },
    rate(mk, g){
      if(!this.rates) this.rollMarkets();
      return this.rates[mk] ? this.rates[mk][g] : 1;
    },
    tradeBuyPrice(good, market){
      return Math.max(1, Math.round(TRADE_GOODS[good].base * this.rate(market, good)));
    },
    tradeSellPrice(good, market){
      return Math.max(1, Math.round(TRADE_GOODS[good].base * this.rate(market, good) * 0.9));
    },
    buyTradeGood(good, market, qty){
      const cost = this.tradeBuyPrice(good, market) * qty;
      if(this.credits < cost) return 0;
      const free = this.cargoMax() - this.cargoUsed();
      const take = Math.min(qty, free);
      if(take <= 0) return 0;
      this.credits -= this.tradeBuyPrice(good, market) * take;
      this.trade[good] += take;
      return take;
    },
    sellTradeGood(good, market, qty){
      const have = this.trade[good] | 0;
      const n = Math.min(qty, have);
      if(n <= 0) return 0;
      this.credits += this.tradeSellPrice(good, market) * n;
      this.trade[good] -= n;
      return n;
    },
    addItem(type, n){
      n = n || 1;
      const free = this.cargoMax() - this.cargoUsed();
      const take = Math.min(n, free);
      if(take > 0) this.cargo[type] = (this.cargo[type] || 0) + take;
      return take;
    },
    priceSell(type, planetType){
      let mult = 1;
      if(planetType === 'hostile') mult = 1.25;
      return Math.round(COMMS[type].base * mult);
    },
    dmg(n){
      if(!this.alive) return;
      if(this.shield > 0){
        const absorbed = Math.min(this.shield, n);
        this.shield -= absorbed;
        n -= absorbed;
      }
      if(n > 0) this.hp -= n;
      if(this.hp <= 0){
        this.hp = 0;
        this.alive = false;
      }
    },
    healFull(){
      this.hp = this.hullMax();
      this.shield = this.shieldMax();
      this.alive = true;
    },
    useMedkit(){
      if(this.medkits <= 0 || this.hp >= this.hullMax()) return false;
      this.medkits--;
      this.hp = Math.min(this.hullMax(), this.hp + 55);
      return true;
    },
    resetShipState(){
      this.hp = this.hullMax();
      this.shield = this.shieldMax();
      this.alive = true;
    },
    save(){
      try{
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          credits: this.credits, medkits: this.medkits, cargo: this.cargo,
          trade: this.trade, up: this.up, installed: this.installed,
          modules: this.modules, missions: this.missions,
          missionsDone: this.missionsDone
        }));
      }catch(e){}
    },
    load(){
      try{
        const s = JSON.parse(localStorage.getItem(SAVE_KEY));
        if(!s) return;
        this.credits = s.credits != null ? s.credits : this.credits;
        this.medkits = s.medkits != null ? s.medkits : this.medkits;
        if(s.cargo) for(const k in this.cargo) this.cargo[k] = s.cargo[k] | 0;
        if(s.trade) for(const k in this.trade) this.trade[k] = s.trade[k] | 0;
        if(s.up) for(const k in this.up) this.up[k] = s.up[k] || 1;
        if(Array.isArray(s.installed)) this.installed = s.installed.filter(k => MODULE_DEFS[k]).slice(0, MODULE_SLOTS);
        if(Array.isArray(s.modules)) this.modules = s.modules.filter(k => MODULE_DEFS[k]).slice(0, MODULE_STORE_CAP);
        if(Array.isArray(s.missions)) this.missions = s.missions.slice(0, 3);
        this.missionsDone = s.missionsDone | 0;
      }catch(e){}
    }
  };
  P.resetShipState();
  P.rollMarkets();
  P.load();
  window.PD = P;
  window.COMMS = COMMS;
  window.PLANETS = PLANETS;
  window.STATIONS = STATIONS;
  window.TRADE_GOODS = TRADE_GOODS;
  window.TRADE_MARKETS = TRADE_MARKETS;
  window.MARKET_NAMES = MARKET_NAMES;
  window.MODULE_DEFS = MODULE_DEFS;
  window.MODULE_SLOTS = MODULE_SLOTS;
  window.MODULE_STORE_CAP = MODULE_STORE_CAP;
})();
