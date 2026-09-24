// Economy report: for each cup, prize money earned against what a full team costs.
//
// Queues every round with the real WaveManager (trash halving, threats, pay
// scale and milestones as the game pays them) and assumes the best case: every
// creep knocked out, nothing caught, no Meowth bounties or Pay Day. A "full
// build" is the priciest legal 3-2-0 each species can buy at the cup's level
// cap, plus its deploy cost, averaged over every species, times a team of six.
// Target (docs/match-length.md): the team is fully built around the final's
// breather round (F3), so money matters for the whole match instead of running
// out of things to buy by round 12.
//
//   node tools/economy.mjs [teamSize=6]

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  stdin: {
    contents: [
      "export { WaveManager, getMilestone } from './src/td/WaveManager.ts';",
      "export { CUPS, CUP_ORDER, finalStartRound } from './src/td/Cups.ts';",
      "export { SPECIES } from './src/td/progression/Species.ts';",
      "export { STADIUM_MAPS } from './src/td/MapCatalog.ts';",
      "export { Vector3 } from 'three';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' },
});
const { WaveManager, getMilestone, CUPS, CUP_ORDER, finalStartRound, SPECIES, STADIUM_MAPS, Vector3 } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

const TEAM_SIZE = Number(process.argv[2] ?? 6);

/** The priciest legal build a species can buy with every tier gated at or under `level`. */
function fullBuild(species, level) {
  const open = species.paths.map(path => path.tiers.filter(t => (t.requiresLevel ?? 0) <= level).map(t => t.cost));
  const upTo = (costs, depth) => costs.slice(0, depth).reduce((sum, cost) => sum + cost, 0);
  let best = 0;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    if (a !== b) best = Math.max(best, upTo(open[a], 3) + upTo(open[b], 2));
  }
  return species.deployCost + best;
}

/** Prize money a fully cleared round pays, knockouts plus any milestone. */
function roundIncome(cup, map, round) {
  const waves = new WaveManager([[new Vector3(0, 0, 0), new Vector3(1, 0, 0)]], { trigger() {} }, cup, undefined, map.typeWeights, map.id);
  waves.currentWaveIndex = round - 1;
  const wave = waves.getCurrentWave();
  waves.startNextWave();
  const knockouts = waves.spawnQueue.reduce((sum, entry) => sum + Math.round(entry.config.reward * (wave.payMult ?? 1)), 0);
  return knockouts + (getMilestone(round, cup.winRound)?.money ?? 0);
}

const rows = [];
for (const id of CUP_ORDER) {
  const cup = CUPS[id];
  const species = Object.values(SPECIES);
  const team = Math.round(species.reduce((sum, s) => sum + fullBuild(s, cup.levelCap), 0) / species.length * TEAM_SIZE);
  for (const map of STADIUM_MAPS.filter(m => m.cup === id)) {
    let bank = cup.startingMoney;
    let builtAt = null;
    const at = {};
    for (let round = 1; round <= cup.winRound; round++) {
      bank += roundIncome(cup, map, round);
      at[round] = bank;
      if (builtAt === null && bank >= team) builtAt = round;
    }
    const final = finalStartRound(cup);
    rows.push({
      course: map.name,
      cup: cup.name,
      start: cup.startingMoney,
      'by F1': at[final - 1],
      'by F3': at[final + 1],
      'by win': at[cup.winRound],
      'full team': team,
      'built r': builtAt ?? 'never',
      'built at': builtAt ? `${Math.round(builtAt / cup.winRound * 100)}%` : '—',
    });
  }
}

console.log(`Economy · every creep knocked out, nothing caught, a team of ${TEAM_SIZE} at the cup's level cap\n`);
console.table(rows);
console.log('\nTarget: "built r" lands around the final\'s F3 round (winRound − 2).');
