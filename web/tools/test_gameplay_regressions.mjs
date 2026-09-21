import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle the TypeScript classes in memory so these state-machine regressions
// run without a browser or generated files.
const result = await build({
  stdin: {
    contents: [
      "export { StadiumTDGame } from './src/td/StadiumTDGame.ts';",
      "export { leadingActionCreep } from './src/td/StadiumTDGame.ts';",
      "export { StadiumCamera } from './src/engine/StadiumCamera.ts';",
      "export { Input } from './src/engine/Input.ts';",
      "export { canUseSavedTeam } from './src/td/StadiumUI.ts';",
      "export { Tower, rankTargets } from './src/td/Tower.ts';",
      "export { Creep } from './src/td/Creep.ts';",
      "export { Projectile } from './src/td/Projectile.ts';",
      "export { resolveMoveHit, collectVictims, hitDamage, strikeCreeps } from './src/td/MoveDelivery.ts';",
      "export { MOVES } from './src/stadium/MoveDatabase.ts';",
      "export { createPokemon, formOf, statsOf, TrainerStore, STORAGE_MAX } from './src/td/progression/TrainerStore.ts';",
      "export { xpForLevel, creepLevel, MAX_LEVEL } from './src/td/progression/Stats.ts';",
      "export { CUPS, CUP_ORDER, isEligible, nearOutgrowing, isCupUnlocked, unlockedCups } from './src/td/Cups.ts';",
      "export { STADIUM_MAPS } from './src/td/MapCatalog.ts';",
      "export { generateWave, rollWave } from './src/td/WaveManager.ts';",
      "export { createRental, isRental, RENTALS, rentalLevel } from './src/td/progression/Rentals.ts';",
      "export { MatchProgress } from './src/td/progression/MatchProgress.ts';",
      "export { getSpecies, SPECIES } from './src/td/progression/Species.ts';",
      "export { HAZARDS } from './src/td/Hazard.ts';",
      "export { Hazard } from './src/td/Hazard.ts';",
      "export { SummonSequence } from './src/td/SummonSequence.ts';",
      "export { CaptureSequence } from './src/td/CaptureSequence.ts';",
      "export { castSignature, SIGNATURES } from './src/td/Signatures.ts';",
      "export { maskGroundProps } from './src/stadium/MapScenery.ts';",
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
const { StadiumTDGame, StadiumCamera, Input, canUseSavedTeam, leadingActionCreep, Tower, rankTargets, Creep, Projectile, resolveMoveHit, collectVictims, hitDamage, strikeCreeps, MOVES, maskGroundProps,
  createPokemon, formOf, statsOf, TrainerStore, STORAGE_MAX, xpForLevel, creepLevel, MAX_LEVEL, CUPS, CUP_ORDER, isEligible, nearOutgrowing, isCupUnlocked, unlockedCups, STADIUM_MAPS, generateWave, rollWave, createRental, isRental, RENTALS, rentalLevel, MatchProgress, getSpecies, SPECIES, HAZARDS, Hazard, SummonSequence, CaptureSequence, castSignature, SIGNATURES, THREE } =
  await import(`data:text/javascript;base64,${source}`);

// Losing browser focus clears held keys, and touch distinguishes a camera
// drag from a world tap instead of firing on touchstart.
{
  const descriptors = Object.fromEntries(['window', 'document', 'Element', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const windowHandlers = {};
  const documentHandlers = {};
  class FakeElement {}
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: FakeElement });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeElement });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    innerWidth: 1000, innerHeight: 500,
    addEventListener: (name, callback) => { windowHandlers[name] = callback; },
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    hidden: false,
    addEventListener: (name, callback) => { documentHandlers[name] = callback; },
  } });
  const input = new Input({ addEventListener() {} });
  windowHandlers.keydown({ code: 'KeyW', target: null });
  assert.equal(input.isKeyDown('KeyW'), true, 'keydown is held');
  windowHandlers.blur();
  assert.equal(input.isKeyDown('KeyW'), false, 'blur releases held keys');

  const touch = (identifier, clientX, clientY) => ({ identifier, clientX, clientY, target: null });
  const event = list => ({ changedTouches: list, touches: list, preventDefault() {} });
  windowHandlers.touchstart(event([touch(7, 100, 100)]));
  assert.equal(input.clicked, false, 'touchstart does not click');
  windowHandlers.touchmove({ touches: [touch(7, 125, 110)], preventDefault() {} });
  assert.ok(input.dragDelta.lengthSq() > 0, 'touch movement feeds camera drag');
  windowHandlers.touchend(event([touch(7, 125, 110)]));
  assert.equal(input.clicked, false, 'touch drag does not click on release');
  windowHandlers.touchstart(event([touch(8, 200, 200)]));
  windowHandlers.touchend(event([touch(8, 200, 200)]));
  assert.equal(input.clicked, true, 'stationary touch clicks on release');

  for (const key of ['window', 'document', 'Element', 'HTMLElement']) {
    if (descriptors[key] === undefined) delete globalThis[key];
    else Object.defineProperty(globalThis, key, descriptors[key]);
  }
}

// A deliberately benched collection member must force team select rather
// than being silently restored to an open slot.
{
  const pikachu = createPokemon('pikachu', 5, { kind: 'dev', at: 0 });
  const bulbasaur = createPokemon('bulbasaur', 5, { kind: 'dev', at: 0 });
  assert.equal(canUseSavedTeam([pikachu, bulbasaur], [pikachu.uid, null, null, null, null, null], 'poke'), false,
    'a benched Pokémon prevents the course fast path');
  assert.equal(canUseSavedTeam([pikachu, bulbasaur], [pikachu.uid, bulbasaur.uid, null, null, null, null], 'poke'), true,
    'a complete eligible saved team can skip team select');
}

// Action mode follows the live creep nearest the exit. A knockout hands the
// shot off through an eased focus move instead of teleporting to the runner-up.
{
  const creeps = [
    { id: 'rear', alive: true, pathProgress: -20 },
    { id: 'leader', alive: true, pathProgress: -2 },
    { id: 'fainted', alive: false, pathProgress: 0 },
  ];
  assert.equal(leadingActionCreep(creeps)?.id, 'leader', 'action camera chooses the furthest live creep');
  creeps[1].alive = false;
  assert.equal(leadingActionCreep(creeps)?.id, 'rear', 'a fainted leader yields to the next live creep');

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {
    innerWidth: 1280, innerHeight: 720, addEventListener() {},
  } });
  const camera = new StadiumCamera();
  camera.setMode('action');
  camera.setActionTarget('leader', new THREE.Vector3(12, 0, 0));
  for (let frame = 0; frame < 180; frame++) camera.update(1 / 60);
  const followDistance = camera.actionDistance;
  const wheelInput = delta => ({
    dragDelta: new THREE.Vector2(), wheelDelta: delta, isKeyDown: () => false,
  });
  camera.handleInput(wheelInput(-400), 1 / 60);
  assert.ok(camera.actionDistance < followDistance, 'action camera can zoom in while tracking');
  camera.handleInput(wheelInput(800), 1 / 60);
  assert.ok(camera.actionDistance > followDistance, 'action camera can zoom out while tracking');
  camera.handleInput(wheelInput(100000), 1 / 60);
  assert.equal(camera.actionDistance, camera.maxDistance, 'action camera allows the normal maximum zoom-out');
  assert.equal(camera.actionSubjectId, 'leader', 'zooming does not release the tracked creep');
  const oldFocus = camera.actionFollowFocus.clone();
  camera.setActionTarget('rear', new THREE.Vector3(-12, 0, 0));
  camera.update(1 / 60);
  assert.ok(camera.actionFollowFocus.distanceTo(oldFocus) < 1,
    'action camera target handoff starts with a cinematic ease');
  for (let frame = 0; frame < 180; frame++) camera.update(1 / 60);
  assert.ok(camera.actionFollowFocus.distanceTo(new THREE.Vector3(-12, 0, 0)) < 0.1,
    'action camera settles onto the replacement leader');
  if (previousWindow === undefined) delete globalThis.window;
  else Object.defineProperty(globalThis, 'window', previousWindow);
}

// Incidental ground props vanish beneath a tower footprint and return when
// that footprint is removed (for example, after selling the tower).
{
  const root = new THREE.Group();
  const props = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
  const matrices = [new THREE.Matrix4().makeTranslation(0, 0, 0), new THREE.Matrix4().makeTranslation(5, 0, 0)];
  matrices.forEach((matrix, index) => props.setMatrixAt(index, matrix));
  props.userData.clearableGroundProps = {
    matrices,
    positions: [new THREE.Vector2(0, 0), new THREE.Vector2(5, 0)],
    radius: 0.1,
  };
  root.add(props);
  const resultMatrix = new THREE.Matrix4();
  maskGroundProps(root, [{ x: 0, z: 0, radius: 1.6 }]);
  props.getMatrixAt(0, resultMatrix);
  assert.equal(resultMatrix.getMaxScaleOnAxis(), 0, 'covered ground prop is hidden');
  props.getMatrixAt(1, resultMatrix);
  assert.equal(new THREE.Vector3().setFromMatrixPosition(resultMatrix).x, 5, 'clear ground prop remains');
  maskGroundProps(root, []);
  props.getMatrixAt(0, resultMatrix);
  assert.equal(resultMatrix.getMaxScaleOnAxis(), 1, 'ground prop returns after tower removal');
}

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

// Capture naming owns the pause and all gameplay input until its modal closes.
{
  const game = new StadiumTDGame();
  game.ui = { setPauseVisible() {} };
  game.audio = { playSelect() {} };
  game.bindUIEvents();
  game.namingHold = true;
  game.isPaused = true;
  game.pauseMenuOpen = true;
  game.ui.onResumeGame();
  assert.equal(game.isPaused, true, 'pause resume cannot release a naming hold');
  game.pauseMenuOpen = false;
  game.handleInput({
    isKeyJustPressed: code => code === 'Escape', rightClicked: false,
  });
  assert.equal(game.pauseMenuOpen, false, 'Escape is ignored while the trophy card owns input');
}

// Disabled roster members never arm a placement preview.
{
  const member = createPokemon('pikachu', 5, { kind: 'dev', at: 0 });
  const game = new StadiumTDGame();
  game.ui = {};
  game.audio = { playSelect() {} };
  game.bindUIEvents();
  game.money = 9999;
  game.towers = [{ pokemon: member }];
  game.ui.onSelectMember(member);
  assert.equal(game.selectedMember, null, 'deployed member cannot enter placement mode');
  game.towers = [];
  game.money = 0;
  game.ui.onSelectMember(member);
  assert.equal(game.selectedMember, null, 'unaffordable member cannot enter placement mode');
}

// Poké Ball entrances default on and the pause-menu toggle persists an opt-out.
{
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const writes = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
    getItem: () => null, setItem: (key, value) => writes.push([key, value]),
  } });
  const game = new StadiumTDGame();
  assert.equal(game.summonCinematics, true, 'summon cinematics default on');
  game.ui = { setSummonCinematics() {} };
  game.audio = { playSelect() {} };
  game.bindUIEvents();
  game.ui.onToggleSummonCinematics();
  assert.equal(game.summonCinematics, false, 'summon cinematics can be disabled');
  assert.deepEqual(writes.pop(), ['pokestadium.summonCinematics', 'off'], 'summon opt-out persists');
  if (previousStorage === undefined) delete globalThis.localStorage;
  else Object.defineProperty(globalThis, 'localStorage', previousStorage);
}

// Regular balls can be replenished during combat, while premium balls remain
// an intermission purchase and cannot bypass their intended scarcity.
{
  const game = new StadiumTDGame();
  game.ui = {};
  game.audio = { playSelect() {} };
  game.waveManager = { inWave: true };
  game.money = 500;
  game.balls = { poke: 0, great: 0, ultra: 0 };
  game.bindUIEvents();
  game.ui.onBuyBall('poke');
  game.ui.onBuyBall('great');
  assert.deepEqual(game.balls, { poke: 1, great: 0, ultra: 0 }, 'only regular balls can be bought during combat');
  assert.equal(game.money, 465, 'only the successful regular-ball purchase is charged');
}

// Each opening-round clear restores one regular capture attempt. The cadence
// stops once round 10 begins awarding milestone balls.
{
  const game = new StadiumTDGame();
  Object.assign(game, {
    balls: { poke: 0, great: 0, ultra: 0 }, towers: [], map: { id: 'test' },
    store: { data: { maps: {} }, recordMap() {}, commit() {} }, progress: { awardWaveClear: () => [] },
    waveManager: { winRound: 40 }, ui: { showMilestone() {} },
    announcer: { trigger() {} }, audio: { playFanfare() {} }, camera: { shake() {} },
  });
  game.handleRoundCleared(9);
  assert.equal(game.balls.poke, 1, 'round 9 clear grants a regular ball');
  game.handleRoundCleared(10);
  assert.equal(game.balls.poke, 1, 'round 10 does not extend the opening regular-ball grant');
  assert.equal(game.balls.great, 1, 'round 10 retains its premium milestone reward');
}

// Cooldown deadlines preserve overshoot, so speed-up and low frame rates do
// not silently reduce a tower's damage output.
{
  const target = { alive: true, captureLocked: false, position: new THREE.Vector3(1, 0, 0), pathProgress: 0, hp: 1,
    hasTrait: () => false };
  const testTower = () => ({
    attack: { move: { range: 10, attackSpeed: 2, name: 'Test', delivery: 'projectile' }, rate: 1, multishot: 1 },
    cooldown: 0, rateBuff: 0, spin: 0, disabledTimer: 0, surge: { bonus: 0, timer: 0 },
    modifiers: { rate: 1 }, rollShot: () => ({}), targetPriority: 'first', seesPhantoms: false,
    reachAgainst: range => range,
    animPokemon: { mesh: new THREE.Group(), update() {} },
    position: new THREE.Vector3(), attackAnimTimer: 0, entranceAnimTimer: 0,
  });
  const countShots = (dt, frames) => {
    let shots = 0;
    const tower = testTower();
    for (let frame = 0; frame < frames; frame++) {
      Tower.prototype.update.call(tower, dt, [target], () => shots++);
    }
    return shots;
  };
  assert.equal(countShots(0.05, 600), countShots(0.3, 100),
    'equal simulation time produces equal attacks across frame rates');

  let burstShots = 0;
  const idleTower = testTower();
  for (let frame = 0; frame < 100; frame++) Tower.prototype.update.call(idleTower, 0.1, [], () => burstShots++);
  Tower.prototype.update.call(idleTower, 0.05, [target], () => burstShots++);
  Tower.prototype.update.call(idleTower, 0.05, [target], () => burstShots++);
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
    onFaint() {}, popup() {}, showTypeEffectiveness: false,
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
    camera: { camera: { position: new THREE.Vector3() }, handleInput() {}, shake() {}, setActionTarget() {}, update() {} },
    jumbotronCamera: { setActionTarget() {}, update() {} },
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

// Storage has a ceiling: at the cap nothing more is kept, and releasing one
// for research both banks points and frees the slot it took.
{
  const store = new TrainerStore(false);
  const origin = { kind: 'caught', at: 0 };
  for (let i = 0; i < STORAGE_MAX; i++) store.add(createPokemon('rattata', 5, origin), false);
  assert.equal(store.storageUsed, STORAGE_MAX, 'storage fills to the cap');
  assert.equal(store.isStorageFull, true, 'the cap reports full');
  assert.equal(store.add(createPokemon('pikachu', 5, origin), false), false, 'a full collection refuses a catch');
  assert.equal(store.storageUsed, STORAGE_MAX, 'the refused catch is not stored');
  assert.equal(store.data.pokedex.caught.includes('pikachu'), false, 'a refused catch is not marked caught');

  const doomed = store.data.collection[0].uid;
  const earned = store.releaseForResearch(doomed);
  assert.equal(earned, 1, 'releasing one of many copies pays the smallest award');
  assert.equal(store.data.research.rattata, 1, 'research banks against the species');
  assert.equal(store.get(doomed), null, 'the released Pokémon leaves the collection');
  assert.equal(store.storageSpace, 1, 'the release frees a storage slot');
  assert.equal(store.add(createPokemon('pikachu', 5, origin), false), true, 'the freed slot takes the next catch');
}

// The last Pokémon can never be released, and a release clears its team slot.
{
  const store = new TrainerStore(false);
  const origin = { kind: 'caught', at: 0 };
  const first = createPokemon('bulbasaur', 5, origin);
  store.add(first);
  assert.equal(store.canRelease(first.uid), false, 'a lone Pokémon cannot be released');
  assert.equal(store.releaseForResearch(first.uid), null, 'the refused release returns null');

  const second = createPokemon('bulbasaur', 5, origin);
  store.add(second);
  assert.equal(store.researchValue(second.uid), 3, 'parting with a second copy pays the top award');
  assert.equal(store.data.team.includes(second.uid), true, 'the catch took an open team slot');
  assert.equal(store.releaseForResearch(second.uid), 3, 'a second copy can be released');
  assert.equal(store.data.team.includes(second.uid), false, 'a released Pokémon leaves the team');
  assert.equal(store.data.pokedex.caught.includes('bulbasaur'), true, 'releasing keeps the Pokédex entry');
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

// Cup rules: each cap lands inside the next cup's entry window, every course
// has a cup, and creeps climb exactly the cup's range by the win round.
{
  CUP_ORDER.forEach((id, i) => {
    const cup = CUPS[id];
    assert.ok(cup.entryMax <= cup.levelCap, `${id} entry fits under its cap`);
    const next = CUPS[CUP_ORDER[i + 1]];
    if (next) assert.ok(cup.levelCap <= next.entryMax, `${id} graduates into ${next.id}`);
    assert.equal(creepLevel(1, cup, 'normal'), cup.creepLevels[0], `${id} creeps start at the bottom of the range`);
    assert.equal(creepLevel(cup.winRound, cup, 'normal'), cup.creepLevels[1], `${id} creeps top out at the win round`);
    assert.equal(creepLevel(cup.winRound + 30, cup, 'normal'), cup.creepLevels[1], `${id} freeplay holds the top level`);
    assert.ok(creepLevel(cup.winRound, cup, 'titan') <= MAX_LEVEL, `${id} titans respect the level ceiling`);
  });
  for (const map of STADIUM_MAPS) assert.ok(CUPS[map.cup], `${map.name} belongs to a cup`);
  for (const id of CUP_ORDER) {
    assert.ok(STADIUM_MAPS.filter(map => map.cup === id).length >= 2, `${id} offers at least two courses`);
  }
}

// Entry rules: at or under the limit enters, the top of the window warns, and
// the top cup never warns because nothing outgrows it.
{
  assert.ok(isEligible(CUPS.little.entryMax, CUPS.little), 'the entry limit itself may enter');
  assert.ok(!isEligible(CUPS.little.entryMax + 1, CUPS.little), 'one level over sits out');
  assert.ok(nearOutgrowing(CUPS.little.entryMax, CUPS.little), 'the limit level is warned');
  assert.ok(!nearOutgrowing(5, CUPS.little), 'a fresh starter is not warned');
  assert.ok(!nearOutgrowing(CUPS.little.entryMax + 1, CUPS.little), 'an ineligible Pokémon is not warned, it sits out');
  assert.ok(!nearOutgrowing(CUPS.prime.entryMax, CUPS.prime), 'nothing outgrows the top cup');
}

// Cups open in order: clearing any course in a cup opens the next one only.
{
  assert.deepEqual([...unlockedCups(STADIUM_MAPS, {})], ['little'], 'a new trainer starts with the first cup');
  const little = STADIUM_MAPS.find(map => map.cup === 'little');
  const poke = STADIUM_MAPS.find(map => map.cup === 'poke');
  assert.ok(!isCupUnlocked('poke', STADIUM_MAPS, { [little.id]: { cleared: false } }), 'a best round short of a clear opens nothing');
  assert.deepEqual([...unlockedCups(STADIUM_MAPS, { [little.id]: { cleared: true } })], ['little', 'poke'], 'a Little Cup clear opens the Poké Cup');
  assert.ok(!isCupUnlocked('prime', STADIUM_MAPS, { [little.id]: { cleared: true }, [poke.id]: { cleared: true } }), 'cups cannot be skipped');
}

// In-match XP stops at the cup's level cap, evolving on the way; the next
// cup's higher cap lets it climb again.
{
  const store = new TrainerStore(false);
  const charmander = createPokemon('charmander', 10, { kind: 'starter', at: 0 });
  store.gainXp(charmander, xpForLevel(30), CUPS.little.levelCap);
  assert.equal(charmander.level, CUPS.little.levelCap, 'XP stops at the Little Cup cap');
  assert.equal(charmander.xp, xpForLevel(CUPS.little.levelCap), 'no hidden XP banks past the cap');
  assert.equal(formOf(charmander).name, 'Charmeleon', 'evolution below the cap still fires');
  assert.equal(store.gainXp(charmander, 5000, CUPS.little.levelCap).levelsGained, 0, 'a capped Pokémon earns nothing more');
  store.gainXp(charmander, xpForLevel(24) - charmander.xp, CUPS.poke.levelCap);
  assert.equal(charmander.level, 24, 'a higher cup lifts the cap');
}

// Rentals: every cup has a full loaner pool under its entry limit, in the form
// that level has reached.
{
  for (const id of CUP_ORDER) {
    const cup = CUPS[id];
    assert.ok(RENTALS[id].length >= 6, `${id} can field a full rental team`);
    assert.equal(new Set(RENTALS[id]).size, RENTALS[id].length, `${id} rentals are distinct species`);
    assert.equal(rentalLevel(id), cup.entryMax - 2, `${id} rentals enter two levels under the limit`);
    for (const speciesId of RENTALS[id]) {
      const rental = createRental(speciesId, id);
      assert.ok(isEligible(rental.level, cup), `${speciesId} may enter ${id}`);
      assert.ok(isRental(rental) && rental.uid.startsWith('rental_'), `${speciesId} is marked as a loaner`);
    }
  }
  assert.equal(formOf(createRental('charmander', 'great')).name, 'Charmeleon', 'a Great Cup rental arrives evolved for its level');
}

// A rental levels up in the match, shows in the report, and never reaches the save.
{
  const store = new TrainerStore(false);
  const rental = createRental('pikachu', 'little');
  const progress = new MatchProgress(store);
  progress.start([rental], CUPS.little);
  store.gainXp(rental, xpForLevel(12) - rental.xp, CUPS.little.levelCap);
  store.commit();
  assert.equal(rental.level, 12, 'rentals earn XP during the match');
  assert.ok(!store.data.collection.includes(rental), 'rentals never join the collection');
  assert.ok(!JSON.stringify(store.data).includes('rental_'), 'rentals never reach the save');
  const [entry] = progress.report();
  assert.ok(entry?.rental, 'the match report lists the rental');
  assert.equal(entry.pokemon.level, 12, 'the report shows what the rental earned');
}

// Passing the entry limit graduates your own Pokémon from the cup; a rental
// going the same distance doesn't, since it goes back.
{
  const store = new TrainerStore(false);
  const charmander = createPokemon('charmander', 9, { kind: 'starter', at: 0 });
  const stays = createPokemon('squirtle', 5, { kind: 'starter', at: 0 });
  const rental = createRental('pikachu', 'little');
  [charmander, stays].forEach(pokemon => store.add(pokemon));
  const progress = new MatchProgress(store);
  progress.start([charmander, stays, rental], CUPS.little);
  for (const pokemon of [charmander, rental]) store.gainXp(pokemon, xpForLevel(12) - pokemon.xp, CUPS.little.levelCap);
  store.gainXp(stays, xpForLevel(8) - stays.xp, CUPS.little.levelCap);
  const graduated = Object.fromEntries(progress.report().map(entry => [entry.pokemon.speciesId, entry.graduatedFrom]));
  assert.equal(graduated.charmander, 'LITTLE CUP', 'passing the limit graduates the Pokémon');
  assert.equal(graduated.squirtle, null, 'staying under the limit is not a graduation');
  assert.equal(graduated.pikachu, null, 'rentals never graduate');
}

// A catch keeps the creep's level, clamped to the cup cap.
{
  const game = new StadiumTDGame();
  game.map = STADIUM_MAPS.find(map => map.cup === 'little');
  game.waveManager = { round: 30 };
  const caught = game.createCaughtPokemon({ name: 'Rattata', level: 28 }, 'poke');
  assert.equal(caught.level, CUPS.little.levelCap, 'Little Cup catches never exceed its cap');
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

// A roster/database mismatch cannot consume a ball or delete an uncatalogued
// creep through a successful capture with no Pokémon to award.
{
  const game = new StadiumTDGame();
  game.balls = { poke: 2, great: 0, ultra: 0 };
  game.tryCapture({ catchable: true, name: 'Definitely Not A Species' }, 'poke');
  assert.equal(game.balls.poke, 2, 'unmapped creep does not consume a ball');
  assert.equal(game.activeCapture, null, 'unmapped creep does not start capture');
}

// Catch controls throw in one click with the ball selected in the capture kit.
{
  const game = new StadiumTDGame();
  const throws = [];
  game.ui = {};
  game.audio = { playSelect() {} };
  game.balls = { poke: 2, great: 1, ultra: 0 };
  game.tryCapture = (target, ball) => throws.push([target, ball]);
  game.bindUIEvents();
  const target = { name: 'Rattata' };
  game.ui.onSelectBall('great');
  game.ui.onCatch(target);
  assert.equal(game.selectedBall, 'great', 'stock row selects the next capture ball');
  assert.deepEqual(throws, [[target, 'great']], 'catch button immediately throws the selected ball');
  game.ui.onSelectBall('ultra');
  assert.equal(game.selectedBall, 'great', 'an empty ball type cannot replace the selection');
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

  Tower.prototype.update.call({ deploymentLocked: true }, 1, [], () => { fired = true; });
  assert.equal(fired, false, 'a Pokémon cannot attack before its Poké Ball reveal');
}

// A summon locks its tower immediately and skip always restores a usable,
// visible Pokémon while releasing the camera and presentation group.
{
  const scene = new THREE.Scene();
  const model = new THREE.Group();
  const tower = {
    name: 'Pikachu', position: new THREE.Vector3(), animPokemon: { mesh: model, height: 2.2 },
    deploymentLocked: false, setDeploymentLocked: Tower.prototype.setDeploymentLocked,
  };
  let released = 0;
  const noop = () => {};
  const sequence = new SummonSequence(tower, {
    particles: { emitTrail: noop, emitImpact: noop, emitRing: noop, emitAura: noop, emitGroundBurst: noop },
    camera: { camera: { position: new THREE.Vector3(0, 10, 10) }, beginCinematic: noop,
      setCinematicFraming: noop, punchZoom: noop, shake: noop, releaseCinematic: () => released++ },
    audio: { duckCrowd: noop, playSummonThrow: noop, playSummonRelease: noop, playDeploy: noop },
    announcer: { trigger: noop }, arena: { setCrowdMood: noop },
  });
  scene.add(sequence.group);
  assert.equal(tower.deploymentLocked, true, 'summon locks the tower while the ball is in flight');
  assert.equal(model.visible, false, 'summon begins with the Pokémon inside its ball');
  sequence.skip();
  assert.equal(sequence.update(0), true, 'skip completes on the current frame');
  assert.equal(tower.deploymentLocked, false, 'skip unlocks the tower');
  assert.equal(model.visible, true, 'skip leaves the Pokémon visible');
  sequence.dispose(scene);
  assert.equal(released, 1, 'summon returns camera control');
  assert.equal(sequence.group.parent, null, 'summon presentation is removed');
}

// A capture resting shot searches around authored scenery instead of blindly
// parking the camera on the pitch-centre side of the ball.
{
  const target = {
    name: 'Pidgey', threat: 'normal', position: new THREE.Vector3(10, 0.34, 0),
    group: new THREE.Group(),
  };
  let openingAngle = 0;
  const noop = () => {};
  const camera = {
    beginCinematic: (_focus, _distance, _height, angle) => { openingAngle = angle; },
    cinematicPositionAt: (focus, distance, height, angle, result = new THREE.Vector3()) =>
      result.set(focus.x + Math.sin(angle) * distance, focus.y + height, focus.z + Math.cos(angle) * distance),
    setCinematicAngle: noop, setCinematicFraming: noop, punchZoom: noop, shake: noop, releaseCinematic: noop,
  };
  const obstacle = { x: 5, z: 0, radius: 2, label: 'test rock', style: 'rock' };
  const sequence = new CaptureSequence(target, 'poke', 0.5, {
    particles: {}, camera,
    audio: { duckCrowd: noop, playCaptureWindup: noop },
    announcer: {},
    arena: {
      getNoBuildZones: () => [obstacle], setCrowdMood: noop,
      terrain: { heightAt: () => 0 },
    },
  });
  const eye = camera.cinematicPositionAt(target.position, 9.5, 3.2, openingAngle);
  const dx = target.position.x - eye.x, dz = target.position.z - eye.z;
  const lengthSq = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((obstacle.x-eye.x)*dx + (obstacle.z-eye.z)*dz) / lengthSq));
  assert.ok(Math.hypot(obstacle.x-(eye.x+dx*t), obstacle.z-(eye.z+dz*t)) > obstacle.radius,
    'capture camera chooses an unobstructed resting sightline');
  sequence.dispose(new THREE.Scene());
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
  const find = (t, move, creeps) => rankTargets(t, creeps, move, 1)[0] ?? null;
  assert.equal(find(tower(false), MOVES.ember, [ghost]), null, 'phantom is untargetable');
  assert.equal(find(tower(true), MOVES.ember, [ghost]), ghost, 'psychic and ghost towers see phantoms');
  assert.equal(find(tower(false), { ...MOVES.ember, delivery: 'aura' }, [ghost]), ghost, 'auras reach phantoms');
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

// Paralysis stutter follows simulation time, including speed scaling, and
// does not jump forward during a paused (zero-delta) update.
{
  const creep = {
    simulationTime: 0, alive: true, captureLocked: false, threatAura: null,
    captureRing: { visible: false }, baseSpeed: 10, damageStatus: null,
    movementStatus: { effect: 'paralyze', timer: 10 }, auraSlow: 0,
    waypoints: [], currentWpIdx: 0, position: new THREE.Vector3(),
    group: { position: new THREE.Vector3() }, gait: { update() {} },
    animPokemon: { mesh: {}, update() {} }, lastPosition: new THREE.Vector3(),
    entranceTimer: 0, hitAnimationTimer: 0,
  };
  Creep.prototype.update.call(creep, 0.01, () => {});
  assert.equal(creep.speed, 6, 'early paralysis phase permits slowed movement');
  Creep.prototype.update.call(creep, 0.1, () => {});
  assert.equal(creep.speed, 0, 'scaled simulation delta advances paralysis stutter');
  const pausedAt = creep.simulationTime;
  Creep.prototype.update.call(creep, 0, () => {});
  assert.equal(creep.simulationTime, pausedAt, 'pause freezes paralysis phase');
}

// Paths cap at 3-2-0: a second path closes the third, and only one path
// climbs past tier 2. On a crosspath the main path's attack swap wins.
{
  const pathTower = (speciesId, level) => {
    const tower = Object.create(Tower.prototype);
    Object.assign(tower, { species: getSpecies(speciesId), pokemon: { level }, pp: {}, updateRangeRing() {} });
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
  assert.deepEqual(pikachu.pp, { agility: 2 }, 'tier 3 unlocks its signature with full PP');
  pikachu.pp.agility = 0;
  pikachu.refillPP();
  assert.equal(pikachu.pp.agility, 2, 'PP refills to full');
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
    onFaint() {}, popup() {}, showTypeEffectiveness: false,
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

// Signatures with nothing to act on refuse the cast, so no PP is spent. Blaze
// cashes in remaining burns; Fly dives on the healthiest creep it can see.
{
  const damage = [];
  const creep = (name, hp, traits = [], burnTimer = 0) => ({
    name, hp, maxHp: 100, alive: true, captureLocked: false, isBoss: false, types: ['Normal'],
    position: new THREE.Vector3(), hasTrait: trait => traits.includes(trait),
    damageStatus: burnTimer ? { effect: 'burn', timer: burnTimer, source: null } : null,
    applyStatus: () => true, pushBack() {},
    takeDamage(amount) { damage.push([name, Math.round(amount)]); return false; },
  });
  const noop = { emitRing() {}, emitAura() {}, emitBeam() {}, emitImpact() {}, emitGroundBurst() {}, emitSignatureFlash() {} };
  const tower = { position: new THREE.Vector3(), modifiers: { damage: 1, rate: 1, status: 1 }, seesPhantoms: false,
    getMaxRange: () => 10, reachAgainst: range => range };
  const context = creeps => ({
    creeps, towers: [tower], particles: noop, camera: { shake() {}, triggerActionCam() {}, punchZoom() {} }, announcer: { trigger() {} },
    cinematicCuts: false, channel() {},
    hit: { creeps, particles: noop, audio: { playHit() {}, playSignatureCast() {} }, onFaint() {}, popup() {}, showTypeEffectiveness: false },
  });

  assert.equal(castSignature(SIGNATURES.blaze, tower, null, context([creep('dry', 50)])), false, 'blaze needs a burn');
  const burning = creep('burning', 80, [], 2);
  assert.equal(castSignature(SIGNATURES.blaze, tower, null, context([burning])), true, 'blaze fires');
  assert.deepEqual(damage.pop(), ['burning', 16], 'blaze deals the remaining burn at once');
  assert.equal(burning.damageStatus, null, 'blaze consumes the burn');

  castSignature(SIGNATURES.fly, tower, null, context([creep('small', 30), creep('ghost', 900, ['phantom']), creep('big', 90)]));
  assert.equal(damage.pop()[0], 'big', 'fly dives on the healthiest creep it can target');
  assert.equal(castSignature(SIGNATURES.fire_blast, tower, null, context([])), false, 'aimed signatures need a spot');
}

// Every species is fully designed: three paths of three tiers, every move,
// hazard and signature it names exists, each path's tier 3 unlocks exactly one
// signature, and every legal build folds into an attack.
{
  const used = new Set();
  for (const species of Object.values(SPECIES)) {
    assert.ok(MOVES[species.basicAttack], `${species.id} basic attack exists`);
    (species.formAttacks ?? []).forEach(id => assert.ok(MOVES[id], `${species.id} form attack ${id} exists`));
    assert.equal(species.paths.length, 3, `${species.id} has three paths`);
    for (const path of species.paths) {
      assert.equal(path.tiers.length, 3, `${species.id} ${path.id} has three tiers`);
      path.tiers.forEach((tier, i) => {
        const signatures = tier.effects.filter(effect => effect.kind === 'signature');
        assert.equal(signatures.length, i === 2 ? 1 : 0, `${species.id} ${path.id} tier ${i + 1} signature count`);
        for (const effect of tier.effects) {
          if (effect.kind === 'replaceAttack') assert.ok(MOVES[effect.moveId], `${effect.moveId} exists`);
          if (effect.kind === 'hazard') assert.ok(HAZARDS[effect.hazard], `${effect.hazard} exists`);
          if (effect.kind === 'signature') {
            assert.ok(SIGNATURES[effect.signatureId], `${effect.signatureId} exists`);
            assert.ok(!used.has(effect.signatureId), `${effect.signatureId} is used once`);
            used.add(effect.signatureId);
          }
        }
      });
    }
    for (let main = 0; main < 3; main++) {
      for (let side = 0; side < 3; side++) {
        if (side === main) continue;
        const tower = Object.create(Tower.prototype);
        Object.assign(tower, { species, pokemon: { level: 50, stage: species.forms.length - 1 }, pp: {}, updateRangeRing() {} });
        tower.tiers = [0, 0, 0];
        tower.attack = tower.buildAttack();
        for (let i = 0; i < 3; i++) assert.ok(tower.buyUpgrade(main), `${species.id} main path ${main}`);
        for (let i = 0; i < 2; i++) assert.ok(tower.buyUpgrade(side), `${species.id} side path ${side}`);
        assert.equal(tower.attack.signatures.length, 1, `${species.id} ${main}-${side} has one signature`);
      }
    }
  }
  assert.deepEqual([...Object.keys(SIGNATURES)].filter(id => !used.has(id)), [], 'every signature belongs to a path');
}

// Confusion walks a creep back up the lane; Titans are only slowed by it.
{
  const creep = {
    alive: true, captureLocked: false, isBoss: false, maxHp: 100, hp: 100,
    damageStatus: null, movementStatus: null, auraSlow: 0, baseSpeed: 4, speed: 4,
    pushed: 0, pushBack(distance) { this.pushed += distance; }, credit() {},
  };
  Creep.prototype.applyStatus.call(creep, 'confuse', 2);
  assert.equal(creep.movementStatus.effect, 'confuse', 'confusion takes hold');
  const titan = { ...creep, isBoss: true, movementStatus: null };
  Creep.prototype.applyStatus.call(titan, 'confuse', 2);
  assert.equal(titan.movementStatus.effect, 'freeze', 'titans are slowed instead of confused');
}

// Bonus damage and percent damage land on the right victims.
{
  const hits = [];
  const victim = (name, extra) => ({
    name, alive: true, captureLocked: false, isBoss: false, threat: 'normal', hp: 200, types: ['Normal'],
    position: new THREE.Vector3(), movementStatus: null, hasTrait: () => false, applyStatus: () => false,
    takeDamage(amount) { hits.push([name, amount]); return false; }, ...extra,
  });
  const context = { creeps: [], particles: { emitAura() {} }, audio: { playHit() {} }, onFaint() {}, popup() {}, showTypeEffectiveness: false };
  const move = { ...MOVES.quick_attack, basePower: 10 };
  const extras = { bonusVs: [{ target: 'boss', multiplier: 2 }], percentDamage: { share: 0.1, bossShare: 0.01 } };
  strikeCreeps(move, [victim('grunt'), victim('titan', { isBoss: true, threat: 'titan' })], context, null, extras);
  assert.deepEqual(hits, [['grunt', 30], ['titan', 22]], 'boss bonus and percent shares apply by threat');
}

// A creep trait debuts as a lone scout: the first round that fields Airborne,
// Phantom or Armored sends one of it, carrying the group's whole purse, and
// later rounds field it at full strength. A team with no answer to Phantoms
// loses one life learning that, not four.
{
  const winRound = CUPS.little.winRound;
  for (const weights of [undefined, ...STADIUM_MAPS.map(map => map.typeWeights)]) {
    const label = weights ? JSON.stringify(weights) : 'no bias';
    const debut = {};
    const traitsOf = config => [config.type, config.secondaryType].filter(Boolean)
      .flatMap(type => type === 'Flying' ? ['airborne'] : type === 'Ghost' ? ['phantom'] : type === 'Rock' ? ['armored'] : []);

    for (let round = 1; round <= 20; round++) {
      const wave = generateWave(round, winRound, weights);
      const before = { ...debut };
      for (const group of wave.spawns) for (const trait of traitsOf(group.config)) debut[trait] ??= round;
      for (const group of wave.spawns) {
        const traits = traitsOf(group.config);
        if (group.config.isBoss || !traits.length) continue;
        if (traits.some(trait => before[trait] === undefined)) {
          assert.equal(group.count, 1, `${label} round ${round}: ${group.config.name} debuts alone`);
        } else {
          assert.ok(group.count > 1 || group.config.threat === 'elite',
            `${label} round ${round}: ${group.config.name} is no longer a scout`);
        }
      }
    }
    assert.deepEqual(Object.keys(debut).sort(), ['airborne', 'armored', 'phantom'], `${label} teaches every trait by round 20`);
    for (const [trait, round] of Object.entries(debut)) {
      assert.ok(round <= 6, `${label} introduces ${trait} by round 6, not round ${round}`);
    }
  }

  // The scout pays what its whole group would have, so a debut round's income
  // is unchanged and the player can still afford the counter it just met.
  // Heads spawned is the wave manager's density tradeoff: half, at least one.
  const heads = (group) => group.config.isBoss || group.config.threat === 'elite' || group.config.threat === 'titan'
    ? group.count : Math.max(1, Math.round(group.count * 0.5));
  for (const weights of [undefined, ...STADIUM_MAPS.map(map => map.typeWeights)]) {
    for (let round = 1; round <= 12; round++) {
      const played = generateWave(round, winRound, weights);
      const raw = rollWave(round, winRound, weights);
      const purse = wave => wave.spawns.reduce((sum, group) => sum + group.config.reward * heads(group), 0);
      assert.ok(Math.abs(purse(played) - purse(raw)) <= played.spawns.length,
        `round ${round} pays the same whether or not a trait debuts in it`);
    }
  }
  const flyer = generateWave(1, winRound).spawns.find(group => [group.config.type, group.config.secondaryType].includes('Flying'));
  assert.equal(flyer.count, 1, 'round 1 sends a single flyer');
}

console.log('PASS: gameplay timing, capture, summon, defeat, save repair, storage cap, release, evolution, pause, hit shape, armor, status, path cap, chain, knockback, hazard, signature, roster, confusion, bonus damage, trait debuts, and cup rules regressions.');
