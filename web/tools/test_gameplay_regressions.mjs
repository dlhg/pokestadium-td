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
      "export { resolveMoveHit } from './src/td/MoveDelivery.ts';",
      "export { MOVES } from './src/stadium/MoveDatabase.ts';",
      "export { createPokemon, formOf, statsOf, TrainerStore } from './src/td/progression/TrainerStore.ts';",
      "export { xpForLevel } from './src/td/progression/Stats.ts';",
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
const { StadiumTDGame, Tower, Creep, Projectile, resolveMoveHit, MOVES,
  createPokemon, formOf, statsOf, TrainerStore, xpForLevel, THREE } =
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
      species: { lines: [{}] }, cooldowns: [0], modifiers: { rate: 1 },
      getActiveMove: () => ({ range: 10, attackSpeed: 2, name: 'Test' }),
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
    species: { lines: [{}] }, cooldowns: [0], modifiers: { rate: 1 },
    getActiveMove: () => ({ range: 10, attackSpeed: 2, name: 'Test' }),
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
    alive: true, captureLocked: false, types: ['Ground'], position: new THREE.Vector3(),
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

console.log('PASS: gameplay timing, capture, defeat, save repair, evolution, and pause regressions.');
