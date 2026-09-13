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
      "export { createPokemon, formOf, TrainerStore } from './src/td/progression/TrainerStore.ts';",
      "export { xpForLevel } from './src/td/progression/Stats.ts';",
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
const { StadiumTDGame, Tower, Creep, Projectile, createPokemon, formOf, TrainerStore, xpForLevel } =
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

console.log('PASS: wave resume, capture eligibility, captured forms, and paused simulation regressions.');
