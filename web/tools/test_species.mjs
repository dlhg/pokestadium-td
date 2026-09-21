// Species table validation: every invariant Species.ts relies on but cannot state
// in its types, checked against the real MOVES, SIGNATURES, HAZARDS, wave rosters
// and the extracted ROM manifest.
//
// Written for a table that is meant to grow to all 151. Every check reports the
// species and what it expected, and the run collects every failure rather than
// stopping at the first, so adding a batch of species gives one complete list of
// what is wrong with it. Model checks are skipped with a notice when the ROM has
// not been extracted; everything else runs anywhere.
//
//   node tools/test_species.mjs [--verbose]

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const result = await build({
  stdin: {
    contents: [
      "export { SPECIES, getSpecies, dexNumber, speciesForCreepName, STARTER_IDS, GIFT_ID, reachableMoveIds } from './src/td/progression/Species.ts';",
      "export { MOVES } from './src/stadium/MoveDatabase.ts';",
      "export { SIGNATURES } from './src/td/Signatures.ts';",
      "export { HAZARDS } from './src/td/Hazard.ts';",
      "export { EARLY_ROSTER, ROSTER } from './src/td/WaveManager.ts';",
      "export { RENTALS, rentalLevel } from './src/td/progression/Rentals.ts';",
      "export { CUPS, CUP_ORDER } from './src/td/Cups.ts';",
      "export { MAX_LEVEL, computeStats } from './src/td/progression/Stats.ts';",
      "export { stageForLevel } from './src/td/progression/Species.ts';",
      "export { SECONDARY_PATH_MAX_TIER, MAX_PATHS_BOUGHT, buildAttackProfile } from './src/td/TowerAttack.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' },
});
const {
  SPECIES, getSpecies, dexNumber, speciesForCreepName, STARTER_IDS, GIFT_ID,
  MOVES, SIGNATURES, HAZARDS, EARLY_ROSTER, ROSTER, RENTALS, rentalLevel,
  CUPS, CUP_ORDER, MAX_LEVEL, stageForLevel, buildAttackProfile,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

const VERBOSE = process.argv.includes('--verbose');
const MANIFEST_PATH = fileURLToPath(new URL('../public/generated/stadium/manifest.json', import.meta.url));
const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : null;
const byDex = new Map(manifest?.pokemon.map(entry => [entry.species, entry]) ?? []);

const failures = [];
const notes = [];
let checks = 0;
/** Records a check. `where` is the species or table the failure belongs to. */
function check(where, condition, message) {
  checks++;
  if (!condition) failures.push({ where, message });
}
const note = (message) => notes.push(message);

const species = Object.entries(SPECIES);
const PATHS_PER_SPECIES = 3;
const TIERS_PER_PATH = 3;

// ---- Identity and evolution forms -----------------------------------------
const formOwners = new Map();     // lowercased form name -> "speciesId#stage"
const dexOwners = new Map();      // dex number -> "speciesId Form"

for (const [key, def] of species) {
  check(key, def.id === key, `id "${def.id}" does not match its key`);
  check(key, def.forms.length >= 1 && def.forms.length <= 3, `has ${def.forms.length} forms, expected 1-3`);
  check(key, def.forms[0]?.atLevel === 0, 'base form must have atLevel 0');
  check(key, typeof def.role === 'string' && def.role.length > 0, 'has no role label');
  check(key, typeof def.description === 'string' && def.description.length > 0, 'has no description');
  check(key, def.deployCost > 0, `deployCost ${def.deployCost} must be positive`);
  check(key, def.expYield > 0, `expYield ${def.expYield} must be positive`);

  def.forms.forEach((form, stage) => {
    const at = `${key} stage ${stage} (${form.name})`;
    if (stage > 0) {
      check(key, form.atLevel > def.forms[stage - 1].atLevel,
        `${at} evolves at Lv ${form.atLevel}, not above the previous form's Lv ${def.forms[stage - 1].atLevel}`);
      check(key, form.atLevel <= MAX_LEVEL, `${at} evolves at Lv ${form.atLevel}, above MAX_LEVEL ${MAX_LEVEL}`);
    }
    for (const stat of ['attack', 'speed', 'special']) {
      check(key, form.base[stat] > 0, `${at} has base ${stat} of ${form.base[stat]}`);
    }
    check(key, form.secondaryType !== form.type, `${at} lists ${form.type} as both of its types`);

    // FORM_INDEX maps creeps back onto species by name, so a duplicate form
    // name silently sends every catch of it to whichever species loaded last.
    const nameKey = form.name.toLowerCase();
    const owner = `${key}#${stage}`;
    check(key, !formOwners.has(nameKey), `form name "${form.name}" is also used by ${formOwners.get(nameKey)}`);
    formOwners.set(nameKey, owner);

    // dexNumber() assumes every line evolves in consecutive dex order. That is
    // false for several Gen 1 lines (Eevee, the fossils), so the manifest name
    // is the authority on whether the mapping actually lands on this Pokemon.
    const dex = dexNumber(key, stage);
    check(key, dex !== 999 + stage, `${at} has no BASE_DEX entry (dexNumber fell through to 999)`);
    check(key, dex >= 1 && dex <= 151, `${at} maps to dex #${dex}, outside 1-151`);
    check(key, !dexOwners.has(dex), `${at} maps to dex #${dex}, already taken by ${dexOwners.get(dex)}`);
    dexOwners.set(dex, `${key} ${form.name}`);

    if (manifest) {
      const entry = byDex.get(dex);
      check(key, !!entry, `${at} maps to dex #${dex}, which the manifest has no model for`);
      if (entry) {
        check(key, entry.name.toLowerCase() === nameKey,
          `${at} maps to dex #${dex}, which is ${entry.name} in the manifest — the line does not run in dex order`);
      }
    }
  });

  check(key, !def.formAttacks || def.formAttacks.length <= def.forms.length,
    `formAttacks has ${def.formAttacks?.length} entries for ${def.forms.length} forms`);
}

// ---- Paths, tiers and the build cap ---------------------------------------
for (const [key, def] of species) {
  check(key, def.paths.length === PATHS_PER_SPECIES, `has ${def.paths.length} paths, expected ${PATHS_PER_SPECIES}`);
  const pathIds = new Set();
  for (const path of def.paths) {
    check(key, !pathIds.has(path.id), `has two paths with id "${path.id}"`);
    pathIds.add(path.id);
    check(key, path.label?.length > 0, `path "${path.id}" has no label`);
    check(key, path.tiers.length === TIERS_PER_PATH,
      `path "${path.id}" has ${path.tiers.length} tiers, expected ${TIERS_PER_PATH}`);

    path.tiers.forEach((tier, index) => {
      const at = `${key} ${path.id} tier ${index + 1} ("${tier.name}")`;
      check(key, tier.cost > 0, `${at} costs ${tier.cost}`);
      check(key, tier.effects.length > 0, `${at} has no effects`);
      check(key, tier.description?.length > 0, `${at} has no description`);
      if (index > 0) {
        check(key, tier.cost > path.tiers[index - 1].cost,
          `${at} costs ${tier.cost}, not more than the tier below it (${path.tiers[index - 1].cost})`);
      }

      // Tier 1 is a path's entry price, so a gate on it locks the whole path.
      // The one shape that earns it is a species gated behind its own
      // evolution (Magikarp opens nothing until Gyarados at Lv 20), so the
      // gate has to land on an evolution level and apply to every path.
      if (index === 0) {
        if (tier.requiresLevel !== undefined) {
          const evolutionLevels = def.forms.slice(1).map(form => form.atLevel);
          check(key, evolutionLevels.includes(tier.requiresLevel),
            `${at} gates tier 1 at Lv ${tier.requiresLevel}, which is not an evolution level (${evolutionLevels.join(', ') || 'none'})`);
          check(key, def.paths.every(other => other.tiers[0].requiresLevel === tier.requiresLevel),
            `${at} gates tier 1 at Lv ${tier.requiresLevel} but its other paths do not match`);
        }
      } else {
        check(key, typeof tier.requiresLevel === 'number', `${at} has no requiresLevel`);
        const previous = path.tiers[index - 1].requiresLevel ?? 0;
        check(key, (tier.requiresLevel ?? 0) >= previous,
          `${at} unlocks at Lv ${tier.requiresLevel}, below the tier under it (Lv ${previous})`);
        check(key, (tier.requiresLevel ?? 0) <= MAX_LEVEL, `${at} unlocks at Lv ${tier.requiresLevel}, above MAX_LEVEL`);
      }

      const signatures = tier.effects.filter(effect => effect.kind === 'signature');
      check(key, signatures.length <= 1, `${at} unlocks ${signatures.length} signatures`);
      if (index === TIERS_PER_PATH - 1) {
        check(key, signatures.length === 1, `${at} is a tier 3 and unlocks no signature`);
      } else {
        check(key, signatures.length === 0, `${at} unlocks a signature below tier 3`);
      }
    });
  }
}

// ---- Every id a tier points at must resolve -------------------------------
const usedSignatures = new Set();
const usedMoves = new Set();
const usedHazards = new Set();

// Signatures build their hit from an existing move (`hit('fire_blast', ...)`),
// so those moves are fired by a tower too and must not read as orphans.
function collectMoveIds(value, into) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) collectMoveIds(item, into); return; }
  if (typeof value.id === 'string' && typeof value.basePower === 'number') into.add(value.id);
  for (const nested of Object.values(value)) collectMoveIds(nested, into);
}
for (const signature of Object.values(SIGNATURES)) collectMoveIds(signature.effect, usedMoves);

for (const [key, def] of species) {
  check(key, !!MOVES[def.basicAttack], `basicAttack "${def.basicAttack}" is not in MOVES`);
  usedMoves.add(def.basicAttack);
  for (const moveId of def.formAttacks ?? []) {
    check(key, !!MOVES[moveId], `formAttacks move "${moveId}" is not in MOVES`);
    usedMoves.add(moveId);
  }
  for (const path of def.paths) {
    for (const tier of path.tiers) {
      for (const effect of tier.effects) {
        switch (effect.kind) {
          case 'replaceAttack':
            check(key, !!MOVES[effect.moveId], `${path.id} swaps to "${effect.moveId}", which is not in MOVES`);
            usedMoves.add(effect.moveId);
            break;
          case 'signature':
            check(key, !!SIGNATURES[effect.signatureId], `${path.id} unlocks "${effect.signatureId}", which is not in SIGNATURES`);
            usedSignatures.add(effect.signatureId);
            break;
          case 'hazard':
            check(key, !!HAZARDS[effect.hazard], `${path.id} drops "${effect.hazard}", which is not in HAZARDS`);
            check(key, effect.everyNth >= 1, `${path.id} drops ${effect.hazard} every ${effect.everyNth} attacks`);
            usedHazards.add(effect.hazard);
            break;
          case 'crit':
            check(key, effect.chance > 0 && effect.chance <= 1, `${path.id} has a crit chance of ${effect.chance}`);
            check(key, effect.multiplier > 1, `${path.id} has a crit multiplier of ${effect.multiplier}`);
            break;
          case 'onHitStatus':
            check(key, effect.chance > 0 && effect.chance <= 1, `${path.id} has a status chance of ${effect.chance}`);
            check(key, effect.duration > 0, `${path.id} has a status duration of ${effect.duration}`);
            break;
          case 'scale':
            for (const field of ['damage', 'rate', 'range']) {
              if (effect[field] !== undefined) {
                check(key, effect[field] > 0, `${path.id} scales ${field} by ${effect[field]}`);
              }
            }
            break;
        }
      }
    }
  }
}

// Every legal build must fold without throwing, including the crosspaths, since
// buildAttackProfile resolves the swapped move at the end of the main path.
for (const [key, def] of species) {
  const tierEffects = (path, depth) => path.tiers.slice(0, depth).flatMap(tier => tier.effects);
  for (const main of def.paths) {
    for (const second of def.paths) {
      if (second === main) continue;
      for (const depth of [0, 1, 2]) {
        try {
          buildAttackProfile(def.basicAttack, [tierEffects(second, depth), tierEffects(main, 3)]);
        } catch (error) {
          check(key, false, `build ${main.id} 3 / ${second.id} ${depth} throws: ${error.message}`);
        }
      }
    }
  }
  checks++;
}

// ---- Wave rosters map back onto species -----------------------------------
for (const [label, roster] of [['EARLY_ROSTER', EARLY_ROSTER], ['ROSTER', ROSTER]]) {
  for (const entry of roster) {
    const match = speciesForCreepName(entry.name);
    check(label, !!match, `"${entry.name}" does not map onto any species form — it can be fought but never caught`);
    if (!match) continue;
    const form = getSpecies(match.speciesId).forms[match.stage];
    const rosterTypes = [entry.type, entry.secondaryType].filter(Boolean).sort().join('/');
    const speciesTypes = [form.type, form.secondaryType].filter(Boolean).sort().join('/');
    check(label, rosterTypes === speciesTypes,
      `"${entry.name}" fights as ${rosterTypes} but is ${speciesTypes} once caught`);
    check(label, entry.maxHp > 0 && entry.speed > 0 && entry.reward > 0, `"${entry.name}" has a non-positive stat`);
  }
}

// ---- Rentals ---------------------------------------------------------------
for (const cupId of CUP_ORDER) {
  const cup = CUPS[cupId];
  const pool = RENTALS[cupId];
  const level = rentalLevel(cupId);
  check(`RENTALS.${cupId}`, Array.isArray(pool) && pool.length > 0, 'has no rental pool');
  check(`RENTALS.${cupId}`, new Set(pool).size === pool.length, 'lists the same species twice');
  check(`RENTALS.${cupId}`, level <= cup.entryMax, `rentals enter at Lv ${level}, above the cup's entry limit of ${cup.entryMax}`);
  const covered = new Set();
  for (const id of pool) {
    const def = SPECIES[id];
    check(`RENTALS.${cupId}`, !!def, `"${id}" is not a species`);
    if (!def) continue;
    const form = def.forms[stageForLevel(def, level)];
    covered.add(form.type);
    if (form.secondaryType) covered.add(form.secondaryType);
    // A rental whose tier 2s are all still locked is a tower that cannot be built.
    const openTiers = def.paths.flatMap(path => path.tiers.filter(tier => (tier.requiresLevel ?? 0) <= level));
    check(`RENTALS.${cupId}`, openTiers.length > PATHS_PER_SPECIES,
      `"${id}" rents at Lv ${level} with only tier 1 unlocked on every path`);
  }
  if (VERBOSE) note(`${cup.name} rentals cover: ${[...covered].sort().join(', ')}`);
}

// ---- Starters and the gift -------------------------------------------------
for (const id of [...STARTER_IDS, GIFT_ID]) {
  check('STARTER_IDS', !!SPECIES[id], `"${id}" is not a species`);
}

// ---- Orphans (reported, not failed) ---------------------------------------
const orphanSignatures = Object.keys(SIGNATURES).filter(id => !usedSignatures.has(id));
const orphanMoves = Object.keys(MOVES).filter(id => !usedMoves.has(id));
const orphanHazards = Object.keys(HAZARDS).filter(id => !usedHazards.has(id));
if (orphanSignatures.length) note(`${orphanSignatures.length} signatures no species unlocks: ${orphanSignatures.join(', ')}`);
if (orphanMoves.length) note(`${orphanMoves.length} moves no tower or signature fires: ${orphanMoves.join(', ')}`);
if (orphanHazards.length) note(`${orphanHazards.length} hazards no tower drops: ${orphanHazards.join(', ')}`);

// ---- Coverage --------------------------------------------------------------
const formCount = species.reduce((total, [, def]) => total + def.forms.length, 0);
note(`${species.length} lines / ${formCount} of 151 forms defined`);
if (!manifest) note('manifest.json is missing, so model and dex-name checks were skipped (see web/ROM_ASSETS.md)');
else {
  const missing = manifest.pokemon.filter(entry => !dexOwners.has(entry.species)).length;
  note(`${missing} of the 151 extracted models have no species entry`);
}

// ---- Report ----------------------------------------------------------------
console.log(`Species validation · ${checks} checks over ${species.length} lines\n`);
for (const line of notes) console.log(`  · ${line}`);
if (failures.length) {
  const grouped = new Map();
  for (const { where, message } of failures) {
    if (!grouped.has(where)) grouped.set(where, []);
    grouped.get(where).push(message);
  }
  console.log(`\n${failures.length} failure(s):\n`);
  for (const [where, messages] of grouped) {
    console.log(`  ${where}`);
    for (const message of messages) console.log(`    ✗ ${message}`);
  }
  process.exit(1);
}
console.log('\nAll species checks passed.');
