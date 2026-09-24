// Course finals validation: every course's hand-made final, checked against
// everything Finals.ts relies on but cannot express in its types, then
// measured against a standard procedural round of the same scaling.
//
// Collects every failure rather than stopping at the first, so a new final
// produces one complete list of what is wrong with it. See docs/match-length.md.
//
//   node tools/test_finals.mjs

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  stdin: {
    contents: [
      "export { FINALS, FINAL_BEATS } from './src/td/Finals.ts';",
      "export { TITANS } from './src/td/Titans.ts';",
      "export { generateWave, finalRosterEntry, scheduleWave, standardRound } from './src/td/WaveManager.ts';",
      "export { CUPS, FINAL_ROUNDS, finalStartRound } from './src/td/Cups.ts';",
      "export { STADIUM_MAPS } from './src/td/MapCatalog.ts';",
      "export { speciesForCreepName, getSpecies } from './src/td/progression/Species.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' },
});
const {
  FINALS, FINAL_BEATS, TITANS, generateWave, finalRosterEntry, scheduleWave, standardRound,
  CUPS, FINAL_ROUNDS, finalStartRound, STADIUM_MAPS, speciesForCreepName, getSpecies,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

const failures = [];
let checks = 0;
const check = (ok, message) => {
  checks++;
  if (!ok) failures.push(message);
};

/** A creep's typing as a sorted key, to compare against the species it's caught as. */
const typing = (type, secondaryType) => [type, secondaryType].filter(Boolean).sort().join('/');

function speciesTyping(name) {
  const match = speciesForCreepName(name);
  if (!match) return null;
  const form = getSpecies(match.speciesId).forms[match.stage];
  return typing(form.type, form.secondaryType);
}

const rows = [];
for (const map of STADIUM_MAPS) {
  const final = FINALS[map.id];
  const cup = CUPS[map.cup];
  check(!!final, `${map.name} has a final`);
  if (!final) continue;

  const titan = TITANS[final.titan];
  check(!!titan, `${map.name}: Titan "${final.titan}" exists`);
  if (titan) {
    check(speciesTyping(`Titan ${titan.name}`) === typing(titan.type, titan.secondaryType),
      `${map.name}: Titan ${titan.name} is caught as a species with its own typing`);
  }
  check(final.rounds.length === FINAL_ROUNDS, `${map.name}: ${FINAL_ROUNDS} rounds`);

  final.rounds.forEach((round, i) => {
    const where = `${map.name} F${i + 1} (${round.name})`;
    check(round.beat === FINAL_BEATS[i], `${where}: beat ${i + 1} is ${FINAL_BEATS[i]}, not ${round.beat}`);
    check(round.groups.length > 0, `${where}: sends something`);
    const titans = round.groups.filter(group => group.creep === 'titan');
    check(titans.length === (round.beat === 'titan' ? 1 : 0),
      `${where}: ${round.beat === 'titan' ? 'exactly one Titan' : 'no Titan outside the finale'}`);
    if (round.beat === 'breather') check((round.payMult ?? 1) > 1, `${where}: a breather pays extra`);

    for (const group of round.groups) {
      check(group.count >= 1 && Number.isInteger(group.count), `${where}: ${group.creep} count is a whole number ≥ 1`);
      check(group.interval > 0, `${where}: ${group.creep} interval is positive`);
      check(group.at === undefined || group.at >= 0, `${where}: ${group.creep} starts at or after the whistle`);
      check(group.route === undefined || (Number.isInteger(group.route) && group.route >= 0 && group.route < map.routes.length),
        `${where}: ${group.creep} route ${group.route} exists (course has ${map.routes.length})`);
      check(group.hp === undefined || group.hp > 0, `${where}: ${group.creep} hp multiplier is positive`);
      if (group.creep === 'titan') continue;
      const entry = finalRosterEntry(group.creep, cup);
      check(!!entry, `${where}: "${group.creep}" is a roster creep`);
      if (!entry) continue;
      const caughtAs = speciesTyping(entry.name);
      check(caughtAs !== null, `${where}: ${entry.name} maps onto a species, so it can be caught`);
      check(caughtAs === null || caughtAs === typing(entry.type, entry.secondaryType),
        `${where}: ${entry.name} fights as the types it's caught as`);
    }

    // The round as the game builds it, measured against a standard procedural round of its scaling.
    const number = finalStartRound(cup) + i;
    let wave;
    try {
      wave = generateWave(number, cup, map.typeWeights, map.id);
    } catch (error) {
      check(false, `${where}: builds (${error.message})`);
      return;
    }
    check(wave.beat === round.beat, `${where}: the game plays it as round ${number}`);
    const scheduled = scheduleWave(wave);
    const sum = pick => scheduled.reduce((total, e) => total + pick(e.config), 0);
    const standard = standardRound(number, cup);
    const boss = scheduled.find(e => e.config.isBoss);
    rows.push({
      course: map.name, round: `${number} F${i + 1}`, beat: round.beat, heads: scheduled.length,
      'HP vs standard': `${Math.round(sum(c => c.maxHp) / standard.hp * 100)}%`,
      'Titan share': boss ? `${Math.round(boss.config.maxHp / standard.hp * 100)}%` : '',
      'pay vs standard': `${Math.round(sum(c => c.reward) * (round.payMult ?? 1) / standard.pay * 100)}%`,
      'last spawn s': Math.max(...scheduled.map(e => e.at)).toFixed(1),
    });
  });
}

for (const id of Object.keys(FINALS)) {
  check(STADIUM_MAPS.some(map => map.id === id), `final "${id}" belongs to a course`);
}

console.log(`Course finals · ${checks} checks over ${Object.keys(FINALS).length} finals\n`);
console.table(rows);
if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const failure of failures) console.log(`  ✘ ${failure}`);
  process.exit(1);
}
console.log('\nAll finals checks passed.');
