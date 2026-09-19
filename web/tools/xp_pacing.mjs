// XP pacing report: for each cup, the round a team reaches the level cap.
//
// Queues every round with the real WaveManager (so trash halving, threats and
// creep levels match the game exactly) and pays XP with the real formulas in
// Stats.ts. Assumes the best case: every creep is knocked out and the team is
// fully placed from round 1, with knockout XP split evenly across it. Real
// matches pay less, so treat these rounds as the earliest a team can cap.
// Target (docs/cup-rules.md): capped at about 75–85% of the win round.
//
//   node tools/xp_pacing.mjs [teamSize=6]

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  stdin: {
    contents: [
      "export { WaveManager } from './src/td/WaveManager.ts';",
      "export { CUPS, CUP_ORDER } from './src/td/Cups.ts';",
      "export { knockoutPool, levelScale, levelForXp, xpForLevel, WAVE_CLEAR_SHARE } from './src/td/progression/Stats.ts';",
      "export { getSpecies, speciesForCreepName } from './src/td/progression/Species.ts';",
      "export { rentalLevel } from './src/td/progression/Rentals.ts';",
      "export { Vector3 } from 'three';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' },
});
const {
  WaveManager, CUPS, CUP_ORDER, knockoutPool, levelScale, levelForXp, xpForLevel, WAVE_CLEAR_SHARE,
  getSpecies, speciesForCreepName, rentalLevel, Vector3,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

const TEAM_SIZE = Number(process.argv[2] ?? 6);
/** Matches MatchProgress's fallback for creeps without a species entry. */
const FALLBACK_EXP_YIELD = 60;

/** Every creep a round sends, as the game queues it. */
function roundSpawns(cup, round) {
  const waves = new WaveManager([[new Vector3(0, 0, 0), new Vector3(1, 0, 0)]], { trigger() {} }, cup);
  waves.currentWaveIndex = round - 1;
  waves.startNextWave();
  return waves.spawnQueue.map(entry => entry.config);
}

/** Level of one tower each round, from `entryLevel`, sharing XP with a team of TEAM_SIZE. */
function climb(cup, entryLevel) {
  let xp = xpForLevel(entryLevel);
  const cap = xpForLevel(cup.levelCap);
  const levels = [];
  for (let round = 1; round <= cup.winRound; round++) {
    let wavePool = 0;
    let waveLevel = 1;
    for (const creep of roundSpawns(cup, round)) {
      const match = speciesForCreepName(creep.name);
      const expYield = match ? getSpecies(match.speciesId).expYield : FALLBACK_EXP_YIELD;
      const threat = creep.threat ?? (creep.isBoss ? 'titan' : 'normal');
      const pool = knockoutPool(expYield, creep.level, threat);
      wavePool += pool;
      waveLevel = creep.level;
      xp = Math.min(cap, xp + Math.max(1, Math.round(pool / TEAM_SIZE * levelScale(levelForXp(xp), creep.level))));
    }
    xp = Math.min(cap, xp + Math.max(1, Math.round(wavePool * WAVE_CLEAR_SHARE * levelScale(levelForXp(xp), waveLevel))));
    levels.push(levelForXp(xp));
  }
  return levels;
}

const pct = (round, cup) => (round ? `${Math.round(round / cup.winRound * 100)}%` : '—');

console.log(`XP pacing · team of ${TEAM_SIZE}, every creep knocked out, XP split evenly (best case)\n`);
const rows = [];
for (const id of CUP_ORDER) {
  const cup = CUPS[id];
  const entries = [
    ['entry limit', cup.entryMax],
    ['rental', rentalLevel(id)],
    ['limit − 5', Math.max(1, cup.entryMax - 5)],
  ];
  for (const [label, entryLevel] of entries) {
    const levels = climb(cup, entryLevel);
    const capRound = levels.findIndex(level => level >= cup.levelCap) + 1 || null;
    const gradRound = cup.entryMax < cup.levelCap ? levels.findIndex(level => level > cup.entryMax) + 1 || null : null;
    rows.push({
      cup: cup.name,
      'enters at': `LV ${entryLevel} (${label})`,
      'LV @ r10': levels[9],
      'LV @ half': levels[Math.floor(cup.winRound / 2) - 1],
      'LV @ win': levels[cup.winRound - 1],
      'graduates r': gradRound ?? '—',
      'caps r': capRound ?? `never (${cup.levelCap})`,
      'caps at': pct(capRound, cup),
    });
  }
}
console.table(rows);
console.log('\nTarget: "caps at" about 75–85% for a team entering at the limit.');
