import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle the TypeScript classes in memory so these state-machine regressions
// run without a browser or generated files.
const result = await build({
  stdin: {
    contents: [
      "export { StadiumTDGame } from './src/td/StadiumTDGame.ts';",
      "export { Tower } from './src/td/Tower.ts';",
      "export { Creep } from './src/td/Creep.ts';",
      "export { Projectile } from './src/td/Projectile.ts';",
      "export { resolveMoveHit, collectVictims, hitDamage } from './src/td/MoveDelivery.ts';",
      "export { MOVES } from './src/stadium/MoveDatabase.ts';",
      "export { createPokemon, formOf, statsOf, TrainerStore } from './src/td/progression/TrainerStore.ts';",
      "export { xpForLevel } from './src/td/progression/Stats.ts';",
      "export { getSpecies } from './src/td/progression/Species.ts';",
      "export { Hazard } from './src/td/Hazard.ts';",
      "export * as THREE from 'three';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  loader: { '.css': 'empty' },
});
const source = Buffer.from(result.outputFiles[0].text).toString('base64');
const { StadiumTDGame, Tower, Creep, Projectile, resolveMoveHit, collectVictims, hitDamage, MOVES,
  createPokemon, formOf, statsOf, TrainerStore, xpForLevel, getSpecies, Hazard, THREE } =
  await import(`data:text/javascript;base64,${source}`);

// Starting the next match must release a keyboard-only pause, or the wave
// enters its active state with a spawn queue that never advances.
{
  const game = new StadiumTDGame();
  let starts = 0;
  game.ui = {};
  game.audio = { playSelect() {}, startMusic() {} };
  game.waveManager = { inWave: false, startNextWave() { starts++; this.inWave = true; } };
  game.bindUIEvents();
  game.isPaused = true;
  game.ui.onStartWave();
  assert.equal(starts, 1, 'next match starts');
  assert.equal(game.isPaused, false, 'starting a match releases keyboard pause');
}

// Cooldown deadlines preserve overshoot, so speed-up and low frame rates do
// not silently reduce a tower's damage output.
{
  const countShots = (dt, frames) => {
    let shots = 0;
    const target = { position: new THREE.Vector3() };
    const tower = {
      attack: { move: { range: 10, attackSpeed: 2, name: 'Test' }, rate: 1 }, cooldown: 0, rateBuff: 0,
      modifiers: { rate: 1 }, rollShot: () => ({}),
      findTarget: () => target,
      animPokemon: { mesh: new THREE.Group(), update() {} },
      position: new THREE.Vector3(), attackAnimTimer: 0, entranceAnimTimer: 0,
    };
    for (let frame = 0; frame < frames; frame++) {
      Tower.prototype.update.call(tower, dt, [], () => shots++);
    }
    return shots;
  };
  assert.equal(countShots(0.05, 600), countShots(0.3, 100),
    'equal simulation time produces equal attacks across frame rates');

  let hasTarget = false;
  let burstShots = 0;
  const target = { position: new THREE.Vector3() };
  const idleTower = {
    attack: { move: { range: 10, attackSpeed: 2, name: 'Test' }, rate: 1 }, cooldown: 0, rateBuff: 0,
    modifiers: { rate: 1 }, rollShot: () => ({}),
    findTarget: () => hasTarget ? target : null,
    animPokemon: { mesh: new THREE.Group(), update() {} },
    position: new THREE.Vector3(), attackAnimTimer: 0, entranceAnimTimer: 0,
  };
  for (let frame = 0; frame < 100; frame++) Tower.prototype.update.call(idleTower, 0.1, [], () => burstShots++);
  hasTarget = true;
  Tower.prototype.update.call(idleTower, 0.05, [], () => burstShots++);
  Tower.prototype.update.call(idleTower, 0.05, [], () => burstShots++);
  assert.equal(burstShots, 1, 'an idle tower does not bank attacks without a target');
}

// Type immunity protects against secondary effects too, and a capture-locked
// target cannot receive a splash status while its throw resolves.
{
  const statusApplications = [];
  const target = {
    alive: true, captureLocked: false, types: ['Ground'], position: new THREE.Vector3(), hasTrait: () => false,
    takeDamage: () => false, applyStatus: effect => statusApplications.push(effect),
  };
  const context = {
    creeps: [target], particles: { emitImpact() {} }, audio: { playHit() {} },
    announcer: { trigger() {} }, onFaint() {},
  };
  const random = Math.random;
  Math.random = () => 0;
  resolveMoveHit(MOVES.thundershock, target, context);
  target.types = ['Water'];
  target.captureLocked = true;
  resolveMoveHit(MOVES.thundershock, target, context);
  Math.random = random;
  assert.deepEqual(statusApplications, [], 'immune and capture-locked targets reject status');
}

// A terminal frame with multiple leaks performs the defeat transition once,
// preserving the report produced by the first and only finishMatch call.
{
  const game = new StadiumTDGame();
  const shownReports = [];
  Object.assign(game, {
    isChoosingMap: false, lives: 1, matchActive: true,
    store: { recordMap() {}, commit() {} }, progress: { report: () => ['earned'] },
    camera: { camera: { position: new THREE.Vector3() }, handleInput() {}, shake() {}, update() {} },
    renderer: { scene: new THREE.Scene(), update() {}, floodlightDim: 0 },
    audio: { playHit() {} }, announcer: { trigger() {}, update() {} },
    waveManager: { update() {}, currentWaveIndex: 0, round: 1, winRound: 40, inWave: true,
      getCurrentWave: () => ({ round: 1, cupName: 'TEST' }) },
    particles: { update() {} }, arena: { update() {}, updateJumbotron() {} },
    ui: { showDefeat: (_map, _round, _win, report) => shownReports.push(report), update() {} },
    handleInput() {}, clearSelection() {}, towers: [], projectiles: [],
    creeps: [0, 1].map(() => ({ update() {}, reachedEnd: true, destroy() {} })),
  });
  game.update(0.05, {});
  assert.deepEqual(shownReports, [['earned']], 'defeat report is shown once');
}

// A partially corrupted save repairs required fields before gameplay reads it.
{
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
    getItem: () => JSON.stringify({
      version: 1, starterChosen: true,
      collection: [{ uid: 'survivor', speciesId: 'pikachu', stage: 99, level: 5 }],
      team: ['survivor'], pokedex: { seen: [null, 'pikachu'], caught: 'bad' },
    }),
    setItem() {},
  } });
  const store = new TrainerStore();
  assert.doesNotThrow(() => statsOf(store.team[0]), 'repaired save has usable stats');
  assert.deepEqual(store.team[0].dvs, { attack: 8, speed: 8, special: 8 });
  assert.equal(store.team[0].stage, 1, 'invalid evolution stage is clamped');
  if (previousStorage === undefined) delete globalThis.localStorage;
  else Object.defineProperty(globalThis, 'localStorage', previousStorage);
}

// A wild Pokemon keeps the form that was caught even when its wild level is
// above that form's normal evolution threshold. Incidental XP must not evolve
// it; the next real level-up should.
{
  const store = new TrainerStore(false);
  const rattata = createPokemon('rattata', 20, { kind: 'caught', at: 0 }, { stage: 0 });
  assert.equal(formOf(rattata).name, 'Rattata', 'capture preserves the field form');

  store.gainXp(rattata, 1);
  assert.equal(rattata.level, 20, 'small XP award does not level up');
  assert.equal(formOf(rattata).name, 'Rattata', 'small XP award does not force evolution');

  store.gainXp(rattata, xpForLevel(21) - rattata.xp);
  assert.equal(rattata.level, 21, 'enough XP reaches the next level');
  assert.equal(formOf(rattata).name, 'Raticate', 'over-level capture evolves on a real level-up');
}

// The faint animation remains clickable briefly, but a dead target cannot
// begin capture or spend inventory.
{
  const game = new StadiumTDGame();
  game.selectedBall = 'poke';
  game.balls = { poke: 2, great: 0, ultra: 0 };
  game.tryCapture({ alive: false, captureLocked: false, hpFraction: 0 });
  assert.equal(game.balls.poke, 2, 'fainted target does not consume a ball');
  assert.equal(game.activeCapture, null, 'fainted target does not start capture');
}

// Zero simulation time is a hard pause for every gameplay entity. This also
// catches the fresh-tower case, whose initial cooldown is ready to fire.
{
  let fired = false;
  Tower.prototype.update.call({}, 0, [], () => { fired = true; });
  assert.equal(fired, false, 'tower does not attack while paused');

  let died = false;
  Creep.prototype.update.call({}, 0, () => { died = true; });
  assert.equal(died, false, 'creep does not tick while paused');

  const projectile = { active: true };
  assert.equal(Projectile.prototype.update.call(projectile, 0, {}), true,
    'projectile remains pending while paused');
}

// Hit shapes decide who a move catches: a beam pierces its line, a cone its
// arc, a field rings the caster and passes under anything Airborne.
{
  const creepAt = (x, z, traits = []) => ({
    alive: true, captureLocked: false, position: new THREE.Vector3(x, 0, z),
    hasTrait: trait => traits.includes(trait),
  });
  const geometry = { origin: new THREE.Vector3(), direction: new THREE.Vector3(1, 0, 0), reach: 12 };
  const inLine = [creepAt(3, 0), creepAt(8, 0.8), creepAt(11, -1)];
  const offLine = creepAt(6, 4);
  const beyond = creepAt(14, 0);
  const behind = creepAt(-3, 0);
  const all = [...inLine, offLine, beyond, behind];

  const beam = { ...MOVES.hydro_pump, delivery: 'beam', pierce: undefined };
  assert.deepEqual(collectVictims(beam, inLine[0], all, geometry), inLine, 'beam pierces its whole line');
  assert.deepEqual(collectVictims({ ...beam, pierce: 2 }, inLine[0], all, geometry), inLine.slice(0, 2),
    'pierce stops after the nearest creeps');

  const cone = { ...MOVES.flamethrower, delivery: 'cone', coneAngle: 90 };
  const coneHits = collectVictims(cone, inLine[0], all, geometry);
  assert.ok(coneHits.includes(offLine) && !coneHits.includes(behind) && !coneHits.includes(beyond),
    'cone catches its arc out to reach');

  const flyer = creepAt(0, 5, ['airborne']);
  const field = { ...MOVES.earthquake, delivery: 'field' };
  const fieldHits = collectVictims(field, inLine[0], [...all, flyer], geometry);
  assert.ok(fieldHits.includes(behind) && !fieldHits.includes(flyer) && !fieldHits.includes(beyond),
    'field rings the caster and misses Airborne creeps');
}

// Most towers can't aim at Phantoms; seers and untargeted moves can. Fields
// never fire at Airborne creeps they would pass under.
{
  const ghost = { alive: true, captureLocked: false, position: new THREE.Vector3(2, 0, 0), pathProgress: 1,
    hasTrait: trait => trait === 'phantom' };
  const bird = { alive: true, captureLocked: false, position: new THREE.Vector3(3, 0, 0), pathProgress: 0,
    hasTrait: trait => trait === 'airborne' };
  const tower = (seesPhantoms) => ({ position: new THREE.Vector3(), targetPriority: 'first', seesPhantoms,
    reachAgainst: range => range });
  const find = (t, move, creeps) => Tower.prototype.findTarget.call(t, creeps, move);
  assert.equal(find(tower(false), MOVES.ember, [ghost]), null, 'phantom is untargetable');
  assert.equal(find(tower(true), MOVES.ember, [ghost]), ghost, 'psychic and ghost towers see phantoms');
  assert.equal(find(tower(false), MOVES.toxic, [ghost]), ghost, 'auras reach phantoms');
  assert.equal(find(tower(false), MOVES.earthquake, [bird]), null, 'fields ignore airborne');
}

// Armor halves Light hits only; fixed damage and Heavy moves land in full.
{
  const rock = { types: ['Normal'], hasTrait: trait => trait === 'armored' };
  assert.equal(hitDamage(MOVES.quick_attack, rock).damage, MOVES.quick_attack.basePower * 0.5, 'light hit is halved');
  assert.equal(hitDamage(MOVES.hyper_beam, rock).damage, MOVES.hyper_beam.basePower, 'heavy hit lands in full');
  assert.equal(hitDamage(MOVES.seismic_toss, rock).damage, MOVES.seismic_toss.basePower, 'fixed damage is heavy');
}

// A creep holds one damage-over-time and one movement effect at once; sleep
// breaks on a direct hit but not on a tick, and Titans are only ever slowed.
{
  const blank = (isBoss = false) => ({
    alive: true, captureLocked: false, isBoss, maxHp: 100, hp: 100, contributors: new Map(),
    damageStatus: null, movementStatus: null, updateHpBar() {}, credit() {},
  });
  const creep = blank();
  Creep.prototype.applyStatus.call(creep, 'burn', 4);
  Creep.prototype.applyStatus.call(creep, 'sleep', 3);
  assert.equal(creep.damageStatus.effect, 'burn', 'burn survives a movement status');
  assert.equal(creep.movementStatus.effect, 'sleep', 'sleep stacks alongside burn');
  assert.equal(Creep.prototype.applyStatus.call(creep, 'freeze', 10), false, 'a slow cannot displace sleep');
  Creep.prototype.takeDamage.call(creep, 1, null, true);
  assert.equal(creep.movementStatus?.effect, 'sleep', 'a burn tick does not wake');
  Creep.prototype.takeDamage.call(creep, 1);
  assert.equal(creep.movementStatus, null, 'a direct hit wakes');

  const titan = blank(true);
  Creep.prototype.applyStatus.call(titan, 'stun', 4);
  assert.deepEqual([titan.movementStatus.effect, titan.movementStatus.timer], ['freeze', 2],
    'titans are slowed, briefly, instead of stopped');
}

// Paths cap at 3-2-0: a second path closes the third, and only one path
// climbs past tier 2. On a crosspath the main path's attack swap wins.
{
  const pathTower = (speciesId, level) => {
    const tower = Object.create(Tower.prototype);
    Object.assign(tower, { species: getSpecies(speciesId), pokemon: { level }, totalInvested: 0, updateRangeRing() {} });
    tower.tiers = tower.species.paths.map(() => 0);
    tower.attack = tower.buildAttack();
    return tower;
  };

  const pikachu = pathTower('pikachu', 50);
  assert.equal(pikachu.attack.move.id, 'thundershock', 'starts on the basic attack');
  assert.ok(pikachu.buyUpgrade(0) && pikachu.buyUpgrade(0), 'storm to tier 2');
  assert.deepEqual(pikachu.upgradeConsequences(2), { closes: [1], caps: [] }, 'opening a second path warns it closes the third');
  assert.ok(pikachu.buyUpgrade(2) && pikachu.buyUpgrade(2), 'agility to tier 2');
  assert.equal(pikachu.getUpgradeBlockReason(1), 'path_closed', 'third path is closed');
  assert.equal(pikachu.attack.move.id, 'thunderbolt', 'on a tie the earlier path is main; Quick Attack is ignored');
  assert.equal(pikachu.attack.chain, 4, 'crosspath effects still apply');
  assert.deepEqual(pikachu.upgradeConsequences(2), { closes: [], caps: [0] }, 'claiming tier 3 warns it caps the other path');
  assert.ok(pikachu.buyUpgrade(2), 'agility claims tier 3');
  assert.equal(pikachu.attack.move.id, 'quick_attack', 'the main path now decides the attack');
  assert.equal(pikachu.getUpgradeBlockReason(0), 'tier_capped', 'storm is capped at tier 2');

  const lowLevel = pathTower('charmander', 5);
  assert.ok(lowLevel.buyUpgrade(0), 'tier 1 needs no level');
  assert.equal(lowLevel.getUpgradeBlockReason(0), 'needs_level', 'tier 2 waits on level');
}

// Chains jump to the nearest unhit creep in reach; knockback walks a creep
// back along its route without passing the start.
{
  const hits = [];
  const creepAt = (name, x) => ({
    name, alive: true, captureLocked: false, isBoss: false, types: ['Water'], position: new THREE.Vector3(x, 0, 0),
    hasTrait: () => false, applyStatus: () => false, takeDamage: amount => { hits.push([name, amount]); return false; },
  });
  const creeps = [creepAt('a', 0), creepAt('b', 4), creepAt('c', 8), creepAt('far', 30)];
  const context = {
    creeps, particles: { emitImpact() {}, emitBeam() {}, emitAura() {} }, audio: { playHit() {} },
    announcer: { trigger() {} }, onFaint() {},
  };
  resolveMoveHit({ ...MOVES.thunderbolt, statusEffect: 'none' }, creeps[0], context, null, null, { chain: 4 });
  assert.deepEqual(hits.map(([name]) => name), ['a', 'b', 'c'], 'chain hops creep to creep within reach');
  assert.ok(hits[1][1] < hits[0][1], 'chained hits carry reduced damage');

  const walker = {
    alive: true, captureLocked: false, group: new THREE.Group(),
    waypoints: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 0, 10)],
    remainingAtWaypoint: [20, 10, 0], currentWpIdx: 2, position: new THREE.Vector3(10, 0, 3), pathProgress: -7,
  };
  Creep.prototype.pushBack.call(walker, 5);
  assert.ok(walker.position.distanceTo(new THREE.Vector3(8, 0, 0)) < 1e-6, 'knockback rounds the corner backwards');
  assert.equal(walker.pathProgress, -12, 'path progress follows the push');
  Creep.prototype.pushBack.call(walker, 50);
  assert.ok(walker.position.equals(walker.waypoints[0]), 'knockback stops at the start of the route');
}

// Lane hazards catch Phantoms (they never aim) but not Airborne creeps, and
// burn out after their duration.
{
  const scene = new THREE.Scene();
  const hazard = new Hazard('ember_patch', new THREE.Vector3(), null, scene);
  const statuses = [];
  const creep = (name, traits) => ({
    name, alive: true, captureLocked: false, types: ['Normal'], position: new THREE.Vector3(0.5, 0, 0),
    hasTrait: trait => traits.includes(trait), takeDamage: () => false,
    applyStatus: effect => { statuses.push([name, effect]); return true; },
  });
  const ghost = creep('ghost', ['phantom']);
  const bird = creep('bird', ['airborne']);
  assert.equal(hazard.update(0.1, [ghost, bird], () => {}), true, 'hazard is live');
  assert.deepEqual(statuses, [['ghost', 'burn']], 'phantoms burn, flyers pass over');
  assert.equal(hazard.update(5, [], () => {}), false, 'hazard burns out');
  hazard.destroy(scene);
}

console.log('PASS: gameplay timing, capture, defeat, save repair, evolution, pause, hit shape, armor, status, path cap, chain, knockback, and hazard regressions.');
