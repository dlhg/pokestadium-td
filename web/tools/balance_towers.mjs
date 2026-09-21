// Tower balance lab: how fast every species clears a lane, and what that costs,
// at the top of each cup, using the game's own combat code.
//
// The tower half of the balance lab `docs/cup-rules.md` asks for. One tower is
// stood beside a straight lane with a pack of creeps on it and run at 60 fps
// until the pack is down, through the real `buildAttackProfile`, `collectVictims`
// and `hitDamage` — so hit shapes, pierce, cone width, chains, armor, the type
// chart, Rage ramp-up, spin-up, hazard ticks and Super Fang's shrinking bite all
// behave exactly as they do in a match.
//
// What it deliberately leaves out is the rest of the match: pathing and leakage,
// several towers overlapping, signature moves (PP-limited and player-triggered),
// and status effects beyond the damage they do. The lane, the pack and the
// reference defender are assumptions, stated as constants below, so that two
// species are measured against one yardstick. Read the columns as a ranking.
//
//   node tools/balance_towers.mjs [--cup=little|poke|great|prime] [--crowd=6] [--builds] [--csv]

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  stdin: {
    contents: [
      "export { SPECIES } from './src/td/progression/Species.ts';",
      "export { buildAttackProfile, SECONDARY_PATH_MAX_TIER, MAX_PATHS_BOUGHT } from './src/td/TowerAttack.ts';",
      "export { rankTargets } from './src/td/Tower.ts';",
      "export { collectVictims, hitDamage, CHAIN_DAMAGE_SHARE, CHAIN_JUMP_RANGE } from './src/td/MoveDelivery.ts';",
      "export { getCombinedEffectiveness } from './src/stadium/TypeMatrix.ts';",
      "export { isGroundOnly } from './src/stadium/MoveDatabase.ts';",
      "export { HAZARDS } from './src/td/Hazard.ts';",
      "export { traitsForTypes, ARMOR_LIGHT_MULTIPLIER } from './src/td/Creep.ts';",
      "export { computeStats, towerModifiers } from './src/td/progression/Stats.ts';",
      "export { stageForLevel } from './src/td/progression/Species.ts';",
      "export { CUPS, CUP_ORDER } from './src/td/Cups.ts';",
      "export { EARLY_ROSTER, ROSTER } from './src/td/WaveManager.ts';",
      "export { Vector3 } from 'three';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' },
});
const {
  SPECIES, buildAttackProfile, SECONDARY_PATH_MAX_TIER, MAX_PATHS_BOUGHT, collectVictims, hitDamage,
  CHAIN_DAMAGE_SHARE, CHAIN_JUMP_RANGE, getCombinedEffectiveness, isGroundOnly, HAZARDS,
  traitsForTypes, ARMOR_LIGHT_MULTIPLIER, computeStats, towerModifiers, stageForLevel,
  CUPS, CUP_ORDER, Vector3, rankTargets, EARLY_ROSTER, ROSTER,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

// ---- The yardstick ---------------------------------------------------------
/** Average DVs, so a species is judged on its base stats and not on a roll. */
const REFERENCE_DVS = { attack: 8, speed: 8, special: 8 };
/** Creeps stand this far to the side of the tower, on flat ground. */
const LANE_OFFSET = 2.0;
/** Spacing between creeps in a pack, in arena units. */
const LANE_SPACING = 1.8;
/** How many creeps stand in the lane for the pack columns. */
const DEFAULT_CROWD = 6;
/**
 * The defenders every tower is measured against, taken from the creep roster
 * itself rather than invented. A single reference type is never neutral — a
 * Fighting tower measured against a Normal creep collects a free 2x and reads
 * as overtuned — so damage is averaged over the type spread the game actually
 * fields, traits and all.
 */
const PANEL_SIZE = 6;
const DEFENDER_PANEL = (() => {
  const seen = new Map();
  for (const entry of [...EARLY_ROSTER, ...ROSTER]) {
    const types = [entry.type, entry.secondaryType].filter(Boolean);
    const key = types.join('/');
    seen.set(key, { types, count: (seen.get(key)?.count ?? 0) + 1 });
  }
  return [...seen.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, PANEL_SIZE)
    .map(entry => entry.types);
})();
/** Reference creep HP per cup, near the middle of what that cup's roster fields. */
const REFERENCE_HP = { little: 240, poke: 320, great: 420, prime: 560 };
/** Simulation step, matching a 60 fps game loop. */
const DT = 1 / 60;
/** A run that cannot clear the pack is stopped here and reported as a leak. */
const TIME_LIMIT = 60;
/** Control score at which a tower is read as a controller rather than a damage dealer. */
const CONTROL_THRESHOLD = 0.6;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const found = args.find(arg => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const CROWD = Number(flag('crowd', DEFAULT_CROWD));
const SHOW_BUILDS = args.includes('--builds');
const AS_CSV = args.includes('--csv');
const ONLY_CUP = flag('cup', null);

const TOWER_POSITION = new Vector3(0, 0, 0);

/** A creep stand-in: everything the damage and shape code reads, and nothing else. */
function creepAt(x, z, hp, types, threat = 'normal') {
  const traits = traitsForTypes(types);
  return {
    alive: true, captureLocked: false, types, threat, isBoss: threat === 'titan',
    position: new Vector3(x, 0, z), hp, maxHp: hp, movementStatus: null,
    // Creeps walk up the lane in +X, so how far along one is *is* its x.
    pathProgress: x,
    hasTrait: (trait) => traits.includes(trait),
  };
}

/**
 * A pack strung along the lane, centred on the tower so it has creeps on both
 * sides. `types` is either one defender repeated or the panel dealt around the
 * pack, so a mixed pack carries the roster's real spread of traits.
 */
function lane(count, hp, types) {
  const first = -((count - 1) / 2) * LANE_SPACING;
  return Array.from({ length: count }, (_, i) =>
    creepAt(first + i * LANE_SPACING, LANE_OFFSET, hp, Array.isArray(types[0]) ? types[i % types.length] : types));
}

/** The tower as `rankTargets` reads it: flat ground, default priority, no reveal. */
const TOWER = {
  position: TOWER_POSITION,
  targetPriority: 'first',
  seesPhantoms: false,
  reachAgainst: (range) => range,
};

/** The shape a move cuts, aimed at `target`, on flat ground. */
function geometryFor(move, target) {
  const direction = new Vector3(target.position.x - TOWER_POSITION.x, 0, target.position.z - TOWER_POSITION.z);
  if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
  return { origin: TOWER_POSITION, direction: direction.normalize(), reach: move.range };
}

/** What the tower can reach, in its own target order — the shipped ranking. */
const inRange = (profile, pack) => rankTargets({ ...TOWER, seesPhantoms: profile.seePhantoms },
  pack.filter(creep => creep.alive), profile.move, pack.length);

/**
 * One shot, creep by creep. Mirrors `strikeCreeps`: type chart, armor, the
 * tower's damage stat, the shot's multiplier, any bonusVs, then the percent-HP
 * bite — taken against each victim's *current* HP, so it shrinks as it works.
 */
function applyShot(profile, mods, pack, target, damageMultiplier, share = 1) {
  const geometry = profile.move.delivery === 'projectile' || profile.move.delivery === 'aura'
    ? null : geometryFor(profile.move, target);
  const victims = collectVictims(profile.move, target, pack.filter(creep => creep.alive), geometry);
  for (const victim of victims) {
    const { damage, multiplier } = hitDamage(profile.move, victim);
    if (multiplier <= 0) continue;
    let bonus = 1;
    for (const { target: which, multiplier: extra } of profile.bonusVs) {
      const applies = which === 'boss' ? victim.threat !== 'normal'
        : which === 'held' ? victim.movementStatus !== null
        : victim.hasTrait(which);
      if (applies) bonus *= extra;
    }
    const percent = profile.percentDamage
      ? victim.hp * (victim.isBoss ? profile.percentDamage.bossShare : profile.percentDamage.share) * share
      : 0;
    victim.hp -= Math.floor(damage * share * mods.damage * damageMultiplier * bonus + percent);
    if (victim.hp <= 0) victim.alive = false;
  }
  return victims;
}

/** A hazard patch on the lane, ticking the way `Hazard.update` does. */
function tickHazard(patch, mods, pack) {
  patch.age += DT;
  if (patch.spec.damagePerSecond > 0) {
    for (const creep of pack) {
      if (!creep.alive || creep.hasTrait('airborne')) continue;
      if (Math.hypot(creep.position.x - patch.x, creep.position.z - patch.z) > patch.spec.radius) continue;
      const effectiveness = getCombinedEffectiveness(patch.spec.type, creep.types);
      if (effectiveness <= 0) continue;
      const armor = creep.hasTrait('armored') ? ARMOR_LIGHT_MULTIPLIER : 1;
      creep.hp -= patch.spec.damagePerSecond * DT * effectiveness * armor * mods.damage;
      if (creep.hp <= 0) creep.alive = false;
    }
  }
  return patch.age < patch.spec.duration;
}

/**
 * Runs one tower against a standing pack until it is down. Time-to-clear is
 * what makes Rage ramp up, spin-up wind up, hazards tick and a percent-HP bite
 * shrink with the HP it has already taken — none of which an instantaneous
 * damage figure gets right.
 */
function clearPack(profile, mods, rate, level, crowd, hp, types) {
  const pack = lane(crowd, hp, types);
  const patches = [];
  let cooldown = 0;
  let spin = 0;
  let attackCount = 0;
  let rageStacks = 0;
  let rageTarget = null;
  let elapsed = 0;
  let blocked = false;

  while (elapsed < TIME_LIMIT && pack.some(creep => creep.alive)) {
    for (let i = patches.length - 1; i >= 0; i--) {
      if (!tickHazard(patches[i], mods, pack)) patches.splice(i, 1);
    }

    const reachable = inRange(profile, pack);
    const aimed = reachable.slice(0, profile.multishot);
    // A tower with nothing it can hit and no hazard still burning is not
    // fighting. Stopping here keeps an untargetable creep (a Phantom, or a
    // flier over a ground-only move) from stretching the clock and deflating
    // every damage figure — it is reported as a pack that never cleared.
    if (!aimed.length && !patches.some(patch => patch.spec.damagePerSecond > 0)) {
      blocked = pack.some(creep => creep.alive);
      break;
    }
    if (cooldown > 0) cooldown -= DT;

    if (aimed.length && cooldown <= 0) {
      cooldown += 1 / (rate * (1 + spin));
      attackCount++;
      const target = aimed[0];

      let damageMultiplier = 1 + profile.levelPower * level;
      if (profile.crowdPower) {
        damageMultiplier *= 1 + Math.min(profile.crowdPower.max, profile.crowdPower.perCreep * reachable.length);
      }
      if (profile.rage) {
        rageStacks = target === rageTarget ? Math.min(profile.rage.maxStacks, rageStacks + 1) : 0;
        rageTarget = target;
        damageMultiplier *= 1 + profile.rage.perStack * rageStacks;
      }
      // Crits are taken at their expectation rather than rolled, so two runs of
      // the lab over the same table return the same numbers.
      if (profile.crit) damageMultiplier *= 1 + profile.crit.chance * (profile.crit.multiplier - 1);

      const struck = new Set();
      for (const aim of aimed) {
        for (const victim of applyShot(profile, mods, pack, aim, damageMultiplier)) struck.add(victim);
      }
      let from = target;
      for (let jump = 0; jump < profile.chain; jump++) {
        const next = pack
          .filter(creep => creep.alive && !struck.has(creep)
            && creep.position.distanceTo(from.position) <= CHAIN_JUMP_RANGE)
          .sort((a, b) => a.position.distanceTo(from.position) - b.position.distanceTo(from.position))[0];
        if (!next) break;
        applyShot(profile, mods, pack, next, damageMultiplier, CHAIN_DAMAGE_SHARE);
        struck.add(next);
        from = next;
      }

      if (profile.hazard && attackCount % profile.hazard.everyNth === 0) {
        patches.push({ spec: HAZARDS[profile.hazard.hazard], x: target.position.x, z: target.position.z, age: 0 });
      }
      if (profile.spinUp) spin = Math.min(profile.spinUp.max, spin + profile.spinUp.perShot);
    } else if (profile.spinUp && !aimed.length) {
      spin = Math.max(0, spin - profile.spinUp.max * DT * 0.5);
    }

    elapsed += DT;
  }

  const killed = pack.filter(creep => !creep.alive).length;
  const damage = pack.reduce((total, creep) => total + (creep.maxHp - Math.max(0, creep.hp)), 0);
  return {
    elapsed, killed, damage,
    dps: elapsed > 0 ? damage / elapsed : 0,
    cleared: killed === pack.length,
    // Something in the pack it can never reach: a flier over a ground-only
    // move, or a Phantom it cannot see. Different from simply being too slow.
    blocked,
  };
}

/** Everything one tower is worth at this level, on this lane. */
function evaluate(species, tiers, level, crowd, hp) {
  const stage = stageForLevel(species, level);
  const form = species.forms[stage];
  const mods = towerModifiers(computeStats(form.base, REFERENCE_DVS, level), level);

  const order = species.paths
    .map((path, i) => ({ path, bought: tiers[i], i }))
    .filter(entry => entry.bought > 0)
    .sort((a, b) => a.bought - b.bought || b.i - a.i);
  const basic = species.formAttacks?.[stage] ?? species.basicAttack;
  const profile = buildAttackProfile(basic, order.map(e => e.path.tiers.slice(0, e.bought).flatMap(t => t.effects)));

  // A tower is inside its own rate aura; spin-up is wound up by the run itself.
  const rate = profile.move.attackSpeed * profile.rate * (1 + profile.rateAura) * mods.rate;

  // Solo damage is averaged across the panel; a mixed pack is dealt from it.
  const solos = DEFENDER_PANEL.map(types => clearPack(profile, mods, rate, level, 1, hp, types));
  const pack = clearPack(profile, mods, rate, level, crowd, hp, DEFENDER_PANEL);
  const spent = species.deployCost
    + species.paths.reduce((total, path, i) => total + path.tiers.slice(0, tiers[i]).reduce((sum, t) => sum + t.cost, 0), 0);

  return {
    profile, rate, spent,
    singleDps: solos.reduce((total, run) => total + run.dps, 0) / solos.length,
    packDps: pack.dps,
    ttk: solos.every(run => run.cleared) ? solos.reduce((total, run) => total + run.elapsed, 0) / solos.length : Infinity,
    packTtk: pack.cleared ? pack.elapsed : Infinity,
    packBlocked: pack.blocked,
    range: profile.move.range,
    // Not damage, but the other half of a tower's job: what it takes out of the
    // lane. Scored so a control tower is not read as an underperforming damage
    // one — the lab cannot price a status, but it can say one is there.
    control: profile.slowAura
      + (profile.onHitStatus?.chance ?? 0)
      + (profile.move.statusEffect !== 'none' ? profile.move.statusChance : 0)
      + (profile.knockback ? 0.25 : 0)
      + (profile.hazard && HAZARDS[profile.hazard.hazard].status ? 0.6 : 0)
      + (profile.spreadStatusRadius ? 0.2 : 0),
  };
}

/**
 * Every build the path cap allows at this level: two paths at most, only one of
 * them past tier 2, and no tier bought above the level that gates it. A species
 * whose tier 3 is gated above the cup still gets its best legal build, so it
 * appears in the table as what the cup can actually field rather than vanishing.
 */
function legalBuilds(species, level) {
  const maxDepth = species.paths.map(path => {
    let depth = 0;
    while (depth < path.tiers.length && (path.tiers[depth].requiresLevel ?? 0) <= level) depth++;
    return depth;
  });
  const builds = [];
  const walk = (index, tiers) => {
    if (index === species.paths.length) {
      const bought = tiers.filter(depth => depth > 0);
      if (!bought.length) return;
      if (bought.length > MAX_PATHS_BOUGHT) return;
      if (bought.filter(depth => depth > SECONDARY_PATH_MAX_TIER).length > 1) return;
      const label = species.paths
        .map((path, i) => (tiers[i] ? `${path.label} ${tiers[i]}` : null))
        .filter(Boolean)
        .join(' / ');
      builds.push({ tiers: [...tiers], label });
      return;
    }
    for (let depth = 0; depth <= maxDepth[index]; depth++) walk(index + 1, [...tiers, depth]);
  };
  walk(0, []);
  return builds;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value, places = 0) => (Number.isFinite(value) ? Number(value.toFixed(places)) : '—');

// ---- Report ----------------------------------------------------------------
const cups = (ONLY_CUP ? [ONLY_CUP] : CUP_ORDER).filter(id => CUPS[id]);
const csvRows = [];

if (!AS_CSV) {
  console.log('Defender panel, the most common type lines in the creep roster — solo damage is averaged');
  console.log('over them and the pack is dealt from them:');
  for (const types of DEFENDER_PANEL) {
    const traits = traitsForTypes(types);
    console.log(`  ${types.join('/').padEnd(16)} ${traits.length ? traits.join(', ') : '—'}`);
  }
}

for (const cupId of cups) {
  const cup = CUPS[cupId];
  const level = cup.levelCap;
  const hp = REFERENCE_HP[cupId];
  const entries = [];

  for (const species of Object.values(SPECIES)) {
    const builds = legalBuilds(species, level);
    if (!builds.length) continue;
    const scored = builds.map(entry => ({ ...entry, ...evaluate(species, entry.tiers, level, CROWD, hp) }));
    // A species is represented by its fastest-clearing build, the way a player
    // who is optimising would field it.
    const best = scored.reduce((a, b) => (b.packDps > a.packDps ? b : a));
    const capped = !species.paths.some(path => path.tiers.every(tier => (tier.requiresLevel ?? 0) <= level));
    entries.push({ species, best, scored, capped });
  }
  if (!entries.length) continue;

  const medianSolo = median(entries.map(entry => entry.best.singleDps));
  const medianPack = median(entries.map(entry => entry.best.packDps));
  const medianValue = median(entries.map(entry => entry.best.packDps / entry.best.spent * 100));

  const rows = entries
    .sort((a, b) => b.best.packDps - a.best.packDps)
    .map(({ species, best, scored, capped }) => {
      const soloShare = best.singleDps / medianSolo;
      const packShare = best.packDps / medianPack;
      // A tower that beats the field at both jobs is overtuned; one that beats
      // it at one and trails at the other is a specialist, which is the point.
      // Only the first kind is a balance problem, so only it is flagged.
      const weakest = Math.min(soloShare, packShare);
      const strongest = Math.max(soloShare, packShare);
      // A tower that trades damage for control is doing its job, so it is
      // named rather than flagged; the lab cannot price the status it lands.
      // The most control the species can field, not whatever its damage build
      // happens to carry — a controller usually maxes damage on a different path.
      const control = Math.max(...scored.map(entry => entry.control));
      const controls = control >= CONTROL_THRESHOLD;
      const verdict = weakest >= 1.5 ? '!! strong everywhere' : weakest >= 1.25 ? '! strong everywhere'
        : strongest <= 0.55 ? (controls ? 'control' : '!! weak everywhere')
        : strongest <= 0.75 ? (controls ? 'control' : '! weak everywhere')
        : soloShare / packShare >= 1.6 ? 'single-target'
        : packShare / soloShare >= 1.6 ? 'crowds'
        : '';
      // A tier 3 whose only gain is its signature reads as pure cost here.
      const bestTier3 = scored.filter(entry => entry.tiers.some(depth => depth === 3))
        .reduce((a, b) => (!a || b.packDps > a.packDps ? b : a), null);
      const bestTier2 = scored.filter(entry => entry.tiers.every(depth => depth <= 2))
        .reduce((a, b) => (!a || b.packDps > a.packDps ? b : a), null);
      const hollowTier3 = !!bestTier3 && !!bestTier2 && bestTier3.packDps <= bestTier2.packDps + 1e-6;

      const row = {
        species: species.id,
        role: species.role.replace(/^THE /, ''),
        build: best.label,
        spent: best.spent,
        'solo DPS': round(best.singleDps),
        'pack DPS': round(best.packDps),
        'solo %': `${round(soloShare * 100)}%`,
        'pack %': `${round(packShare * 100)}%`,
        'per 100': round(best.packDps / best.spent * 100, 1),
        range: round(best.range, 1),
        control: round(control, 2),
        clears: best.packTtk !== Infinity ? `${round(best.packTtk, 1)}s` : best.packBlocked ? 'blocked' : 'slow',
        t3: capped ? 'gated' : hollowTier3 ? 'flat' : '',
        verdict,
      };
      csvRows.push({ cup: cup.name, ...row });
      return row;
    });

  if (AS_CSV) continue;

  console.log(`\n${cup.name} · Lv ${level} (level cap) · pack of ${CROWD} × ${hp} HP · average DVs\n`);
  console.table(rows);
  console.log(`  median solo DPS ${round(medianSolo)} · median pack DPS ${round(medianPack)} · median pack DPS per 100 coins ${round(medianValue, 1)}`);

  const gated = rows.filter(row => row.t3 === 'gated');
  if (gated.length) {
    console.log(`  tier 3 gated above Lv ${level}, so these field a partial build: ${gated.map(row => row.species).join(', ')}`);
  }
  const flat = rows.filter(row => row.t3 === 'flat');
  if (flat.length) {
    console.log(`  tier 3 adds no damage the lab can see — it is carried by its signature: ${flat.map(row => row.species).join(', ')}`);
  }
  const blocked = rows.filter(row => row.clears === 'blocked');
  if (blocked.length) {
    console.log(`  left part of the pack untouchable — Airborne over a ground-only move, or a Phantom it cannot see: ${blocked.map(row => row.species).join(', ')}`);
  }
  const slow = rows.filter(row => row.clears === 'slow');
  if (slow.length) console.log(`  could reach the whole pack but not clear it inside ${TIME_LIMIT}s: ${slow.map(row => row.species).join(', ')}`);
  const flagged = rows.filter(row => row.verdict.includes('!'));
  if (flagged.length) {
    console.log(`  out of line: ${flagged.map(row => `${row.species} (${row.verdict.replace(/!+ /, '')} — solo ${row['solo %']}, pack ${row['pack %']})`).join(', ')}`);
  }

  if (SHOW_BUILDS) {
    for (const { species, scored } of entries) {
      console.log(`\n  ${species.id} — every legal build`);
      console.table(scored
        .sort((a, b) => b.packDps - a.packDps)
        .map(entry => ({
          build: entry.label, spent: entry.spent,
          'solo DPS': round(entry.singleDps), 'pack DPS': round(entry.packDps),
          'pack TTK': round(entry.packTtk, 1), 'per 100': round(entry.packDps / entry.spent * 100, 1),
        })));
    }
  }
}

if (AS_CSV) {
  const columns = Object.keys(csvRows[0] ?? {});
  console.log(columns.join(','));
  for (const row of csvRows) console.log(columns.map(key => row[key]).join(','));
} else {
  console.log('\nModel: one tower, a standing pack on a straight lane, flat ground, no signatures, crits at');
  console.log('expectation. Columns rank species against each other under one yardstick — they are not the');
  console.log('damage any particular match will show.');
}
