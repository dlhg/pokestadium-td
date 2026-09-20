/**
 * main.ts — PokéStadium TD Entry Point
 *
 * Boots the 3D colosseum canvas, input tracking, and master game loop.
 * Also includes automated scene-population for headless screenshot verification.
 */

import * as THREE from 'three';
import { StadiumTDGame } from './td/StadiumTDGame';
import { Input } from './engine/Input';
import { Tower, TOWER_BASE_HEIGHT } from './td/Tower';
import { Creep } from './td/Creep';
import { STADIUM_MAPS } from './td/MapCatalog';
import { CUPS } from './td/Cups';
import { getMilestone } from './td/WaveManager';
import { createPokemon, freshSave, TrainerStore } from './td/progression/TrainerStore';
import { DevPanel } from './td/progression/DevPanel';
import { MatchProgress } from './td/progression/MatchProgress';
import { xpForLevel } from './td/progression/Stats';
import { applyRetroUiCss } from './engine/RetroFX';
import { TitleScreen } from './td/TitleScreen';

/** A fixed trainer for headless shots and `?save=dev`: the classic six at the Little Cup's entry limit. */
function devSeed(): TrainerStore {
  const store = new TrainerStore(false, freshSave());
  const origin = { kind: 'dev' as const, at: 0 };
  const dvs = { attack: 8, speed: 8, special: 8 };
  (['pikachu', 'charmander', 'squirtle', 'bulbasaur', 'gastly', 'abra'] as const)
    .forEach(id => store.add(createPokemon(id, CUPS.little.entryMax, origin, { dvs })));
  store.data.starterChosen = true;
  store.data.matchesPlayed = 1;
  return store;
}

/** A throwaway Pokémon for staging shots; `level` decides the evolved form. */
function shotPokemon(speciesId: string, level: number) {
  return createPokemon(speciesId, level, { kind: 'dev', at: 0 }, { dvs: { attack: 8, speed: 8, special: 8 } });
}

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('stadium-canvas') as HTMLCanvasElement;
  const uiContainer = document.getElementById('ui-overlay') as HTMLElement;
  const gameContainer = document.getElementById('game-container') as HTMLElement;

  if (!canvas || !uiContainer || !gameContainer) {
    console.error('Missing canvas or UI overlay container!');
    return;
  }

  // Automated Headless Setup for Visual Verification
  const urlParams = new URLSearchParams(window.location.search);
  const shot = urlParams.get('shot');
  const titleShot = shot === 'title_screen' || shot === 'title_screen_live';

  // Shots always start from the same trainer; everyone else gets their own save.
  const store = shot || urlParams.get('save') === 'dev' ? devSeed() : new TrainerStore();
  const game = new StadiumTDGame();
  game.init(canvas, uiContainer, store);
  // The dev panel lives outside #ui-overlay so RetroFX's HUD-side CSS pass
  // (below) can cover the rest of the game UI without also tinting it.
  const syncRetroUi = () => applyRetroUiCss(gameContainer, game.renderer.retro.settings);
  game.renderer.retro.onChange = syncRetroUi;
  syncRetroUi();
  if (!shot && (import.meta.env.DEV || urlParams.has('dev'))) {
    new DevPanel(gameContainer, game, store);
    // Console handle for poking at a live match while developing.
    (window as unknown as { stadium: StadiumTDGame }).stadium = game;
  }
  // XP earned since the last cleared wave survives a closed tab.
  window.addEventListener('pagehide', () => game.saveProgress());

  const input = new Input(canvas);
  // A stepped shot holds its exact frame instead of drifting with real time.
  let frozenShot = false;

  if (shot) {
    game.announcer.setVoiceEnabled(false);
    uiContainer.classList.add('shot-mode');
  }
  // Team select for the first course, with one member over its entry limit and one about to outgrow it.
  if (shot === 'team_select') {
    const [over, last] = store.team;
    store.setLevel(over, CUPS.little.entryMax + 4);
    store.setLevel(last, CUPS.little.entryMax - 1);
    store.data.collection.push(shotPokemon('pidgey', 7), shotPokemon('zubat', 15));
    document.querySelector<HTMLButtonElement>(`[data-map-id="${STADIUM_MAPS[0].id}"]`)!.click();
  }
  // A veteran whose whole team is over the first cup's limit, after filling with rentals.
  if (shot === 'team_rentals') {
    store.team.forEach(member => store.setLevel(member, CUPS.little.entryMax + 6));
    document.querySelector<HTMLButtonElement>(`[data-map-id="${STADIUM_MAPS[0].id}"]`)!.click();
    document.querySelector<HTMLButtonElement>('[data-fill-rentals]')!.click();
  }
  if (shot === 'pokemon_summary') game.ui.trainer.openSummary(store.team[0].uid);
  // The in-match roster with three members sitting out and three rentals in their places.
  if (shot === 'roster_rentals') {
    store.team.slice(0, 3).forEach(member => store.setLevel(member, CUPS.little.entryMax + 6));
    store.rentalPicks = ['geodude', 'pidgey', 'zubat'];
  }
  // map_<id> is the tactical course view; map3d_<id> frames the same course from the stands.
  const courseShot = STADIUM_MAPS.find(map => shot === `map_${map.id}` || shot === `map3d_${map.id}` || shot === `battle_${map.id}` || shot === `exit_${map.id}`);
  if (courseShot) {
    game.loadMap(courseShot);
    game.announcer.update(60);
    game.isPaused = true;
    if (!shot!.startsWith('map_')) game.camera.setMode('stadium');
    if (shot!.startsWith('exit_')) {
      // Close framing keeps summit signage visible below the HUD.
      const route = game.arena.waypoints;
      game.camera.beginCinematic(route[route.length-1].clone().add(new THREE.Vector3(0,1,0)), 16, 10, 0);
    }
    if (shot!.startsWith('battle_')) {
      // Defenders on each tier and climbers spread along the route, stairs included.
      const terrain = game.arena.terrain;
      const sites: [string, number, number][] = [['pikachu',-6,-25],['charmander',6,-12],['squirtle',-14,17],['bulbasaur',24,-2]];
      for (const [id, x, z] of sites) {
        const tower = new Tower(shotPokemon(id, 5), new THREE.Vector3(x, terrain.footprint(x, z, 1.6).high + TOWER_BASE_HEIGHT, z));
        game.renderer.scene.add(tower.group);
        game.towers.push(tower);
      }
      const route = game.arena.waypoints;
      [0.12, 0.3, 0.36, 0.55, 0.63, 0.9].forEach((at, i) => {
        const creep = new Creep({ id: `climber_${i}`, name: i === 2 ? 'Geodude' : 'Rattata', type: i === 2 ? 'Rock' : 'Normal',
          maxHp: 100, speed: 4, reward: 15, modelType: i === 2 ? 'geodude' : 'rattata' }, route);
        creep.position.copy(route[Math.floor(route.length * at)]);
        creep.group.position.copy(creep.position);
        game.renderer.scene.add(creep.group);
        game.creeps.push(creep);
      });
    }
  }

  // scale_lineup: the size ladder on the narrowest lane, with fully evolved towers
  // parked as close to the lane as placement allows, so any clipping shows.
  if (shot?.startsWith('scale_')) {
    const map = STADIUM_MAPS.reduce((a, b) => (b.laneWidth < a.laneWidth ? b : a));
    game.loadMap(map);
    game.announcer.update(60);
    game.isPaused = true;
    game.camera.setMode('stadium');
    const route = game.arena.waypoints;
    // Keep the two equal-height Ghost/Water species adjacent: this makes the
    // extracted-model scale audit visible in the dedicated screenshot.
    const lineup = ['Pidgey', 'Rattata', 'Pikachu', 'Blastoise', 'Haunter', 'Gengar', 'Rhydon', 'Titan Onix', 'Titan Gyarados'];
    const towers = ['pikachu', 'squirtle', 'bulbasaur', 'charmander'] as const;
    lineup.forEach((name, i) => {
      const at = Math.floor(route.length * (0.08 + i * 0.03));
      const titan = name.startsWith('Titan');
      const creep = new Creep({ id: `scale_${i}`, name, type: 'Normal', maxHp: 100, speed: 4, reward: 15,
        threat: titan ? 'titan' : 'normal', modelType: titan ? 'boss_titan' : 'rattata',
        titanType: name.endsWith('Gyarados') ? 'Gyarados' : 'Onix' }, route);
      creep.position.copy(route[at]);
      creep.group.position.copy(creep.position);
      game.renderer.scene.add(creep.group);
      game.creeps.push(creep);
      if (i % 2) return;
      const along = route[at + 1].clone().sub(route[at - 1]).setY(0).normalize();
      const side = new THREE.Vector3(-along.z, 0, along.x).multiplyScalar(map.laneWidth / 2 + 1.6 + 0.01);
      const spot = [1, -1].map(sign => route[at].clone().addScaledVector(side, sign))
        .find(p => !game.arena.isBuildable(p.x, p.z, 1.6));
      if (!spot) return;
      const { x, z } = spot;
      // Lv 50 puts every line in its final form.
      const tower = new Tower(shotPokemon(towers[(i / 2) % towers.length], 50), new THREE.Vector3(x, game.arena.terrain.footprint(x, z, 1.6).high + TOWER_BASE_HEIGHT, z));
      game.renderer.scene.add(tower.group);
      game.towers.push(tower);
    });
    // scale_lineup frames the small end of the ladder, scale_titans the bosses.
    const focusIndex = shot === 'scale_titans' ? 6 : 2;
    const focus = game.creeps[focusIndex].position;
    game.camera.beginCinematic(focus, shot === 'scale_titans' ? 11 : 8, shot === 'scale_titans' ? 8 : 5.5, 0);
  }

  // evolution_<beat>: a lone Charmander mid-evolution, staged and stepped to
  // one of the set piece's beats without waiting on real knockout XP.
  if (shot?.startsWith('evolution_')) {
    game.loadMap(STADIUM_MAPS[0]);
    game.isPaused = true;
    game.camera.setMode('stadium');
    const tower = new Tower(shotPokemon('charmander', 15), new THREE.Vector3(0, TOWER_BASE_HEIGHT, 0));
    game.renderer.scene.add(tower.group);
    game.towers.push(tower);

    window.setTimeout(() => {
      tower.pokemon.stage = 1; // The level-up that triggers this already landed on the record.
      game.forceEvolution(tower, 'Charmander', 'Charmeleon');
      const step = (frames: number) => { for (let i = 0; i < frames; i++) game.update(1 / 60, input); };
      if (shot === 'evolution_charge') step(35);
      else if (shot === 'evolution_flash') step(80);
      else step(150); // evolution_reveal
      frozenShot = true;
    }, 1200);
  }

  // summon_<beat>: a freshly placed Pokémon arriving from its Poké Ball.
  if (shot?.startsWith('summon_')) {
    game.loadMap(STADIUM_MAPS[0]);
    game.isPaused = true;
    game.camera.setMode('stadium');
    const tower = new Tower(shotPokemon('pikachu', 18), new THREE.Vector3(0, TOWER_BASE_HEIGHT, 0));
    game.renderer.scene.add(tower.group);
    game.towers.push(tower);

    // Let the authentic model settle before freezing a reveal frame; otherwise
    // its async swap can replace the carefully staged scale after the shot stops.
    window.setTimeout(() => {
      game.forceSummon(tower);
      const step = (frames: number) => { for (let i = 0; i < frames; i++) game.update(1 / 60, input); };
      if (shot === 'summon_throw') step(28);
      else if (shot === 'summon_burst') step(48);
      else if (shot === 'summon_reveal') step(98);
      else step(126);
      frozenShot = true;
    }, 1200);
  }

  if (shot && shot !== 'map_select' && shot !== 'team_select' && shot !== 'team_rentals' && shot !== 'pokemon_summary' && !titleShot && !courseShot && !shot.startsWith('scale_') && !shot.startsWith('evolution_') && !shot.startsWith('summon_')) {
    // Disable voice synthesis during headless screenshot capture
    game.announcer.setVoiceEnabled(false);
    game.loadMap(STADIUM_MAPS[0]);
    game.isPaused = true;

      // Populate battle scene for screenshots — free placement means these are
      // just open turf coordinates, chosen clear of the creep lane.
      // Lv 18: every Pikachu tier is open.
      const t0 = new Tower(shotPokemon('pikachu', 18), new THREE.Vector3(-8, TOWER_BASE_HEIGHT, -6));
      game.renderer.scene.add(t0.group);
      game.towers.push(t0);

      const t1 = new Tower(shotPokemon('charmander', 36), new THREE.Vector3(8, TOWER_BASE_HEIGHT, -6)); // Charizard
      t1.buyUpgrade(0); // Inferno: Flamethrower
      t1.buyUpgrade(0); // Inferno: Wide Flame
      t1.buyUpgrade(0); // Inferno: Fire Blast signature
      t1.buyUpgrade(2); // Rage: Rage
      game.renderer.scene.add(t1.group);
      game.towers.push(t1);

      const t3 = new Tower(shotPokemon('squirtle', 36), new THREE.Vector3(0, TOWER_BASE_HEIGHT, 8)); // Blastoise
      t3.buyUpgrade(1); // Chill: Chilling Water
      t3.buyUpgrade(1); // Chill: Cold Front
      t3.buyUpgrade(1); // Chill: Blizzard signature
      game.renderer.scene.add(t3.group);
      game.towers.push(t3);

      if (shot === 'placement_preview') {
        // Hover open turf with Bulbasaur armed for placement so visual
        // verification captures both the side roster and its exact range.
        game.selectedMember = game.roster.find(member => member.speciesId === 'bulbasaur') ?? null;
        game.arena.group.updateMatrixWorld(true);
        game.camera.camera.updateMatrixWorld(true);
        const projected = new THREE.Vector3(-9, TOWER_BASE_HEIGHT, 6).project(game.camera.camera);
        input.mouseNDC.set(projected.x, projected.y);
      } else if (shot !== 'hit_shapes') {
        // Select Pikachu to showcase the path shop: a main path, a crosspath
        // that closed the third, and the cap warning on the next tier.
        t0.buyUpgrade(0); // Storm: Thunderbolt
        t0.buyUpgrade(0); // Storm: Chain Lightning
        t0.buyUpgrade(2); // Agility: Quick Feet
        game.selectedTower = t0;
        t0.setSelected(true);
      }

      // Spawn creeps along the track
      const captureDemo = shot?.startsWith('capture_');
      const c1 = new Creep({
        id: 'demo_1',
        name: captureDemo ? 'Pidgey' : 'Rattata',
        type: 'Normal',
        secondaryType: captureDemo ? 'Flying' : undefined,
        maxHp: 100,
        speed: 4.0,
        reward: 15,
        modelType: captureDemo ? 'zubat' : 'rattata'
      }, game.arena.waypoints);
      c1.position.copy(game.arena.waypoints[8]);
      c1.group.position.copy(c1.position);
      game.renderer.scene.add(c1.group);
      game.creeps.push(c1);

      const c2 = new Creep({
        id: 'demo_2',
        name: 'Zubat',
        type: 'Poison',
        secondaryType: 'Flying',
        maxHp: 120,
        speed: 5.0,
        reward: 20,
        modelType: 'zubat'
      }, game.arena.waypoints);
      c2.position.copy(game.arena.waypoints[12]);
      c2.group.position.copy(c2.position);
      game.renderer.scene.add(c2.group);
      game.creeps.push(c2);

      const c3 = new Creep({
        id: 'demo_3',
        name: 'Titan Onix',
        type: 'Rock',
        maxHp: 1400,
        speed: 2.2,
        reward: 250,
        isBoss: true,
        threat: 'titan',
        modelType: 'boss_titan',
        titanType: 'Onix'
      }, game.arena.waypoints);
      c3.position.copy(game.arena.waypoints[4]);
      c3.group.position.copy(c3.position);
      game.renderer.scene.add(c3.group);
      game.creeps.push(c3);

      const c4 = new Creep({
        id: 'demo_elite', name: 'Geodude', type: 'Rock', secondaryType: 'Ground',
        maxHp: 720, speed: 2.4, reward: 100, threat: 'elite', modelType: 'geodude'
      }, game.arena.waypoints);
      c4.position.copy(game.arena.waypoints[16]);
      c4.group.position.copy(c4.position);
      game.renderer.scene.add(c4.group);
      game.creeps.push(c4);

      if (shot === 'stadium_overview') {
        game.camera.setMode('stadium');
      } else if (shot === 'hit_shapes') {
        // Trait badges and shaped attacks mid-flight: run the fight briefly, then freeze.
        game.camera.setMode('stadium');
        // Park the demo creeps inside the towers' reach so every shape has something to catch.
        [[-4, -3], [3, -3], [2, 3], [7, -10]].forEach(([x, z], i) => {
          const creep = [c1, c2, c3, c4][i];
          creep.position.set(x, game.arena.terrain.raycast(new THREE.Ray(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0)))?.y ?? 0, z);
          creep.group.position.copy(creep.position);
        });
        window.setTimeout(() => {
          game.isPaused = false;
          for (let frame = 0; frame < 24; frame++) game.update(1 / 60, input);
          frozenShot = true;
        }, 1500);
      } else if (shot === 'catch_picker') {
        // A weakened pack bunched on the track: stacked one-click tags, the CATCH NOW tray, and a selected Great Ball.
        const lead = game.arena.waypoints[8];
        [c1, c2, c4].forEach((creep, i) => {
          creep.position.set(lead.x + i * 0.9, lead.y, lead.z + i * 0.5);
          creep.group.position.copy(creep.position);
          creep.hp = creep.maxHp * (0.12 + i * 0.08);
        });
        game.balls = { poke: 3, great: 1, ultra: 0 };
        game.selectedBall = 'great';
      } else if (shot === 'action_cam') {
        game.camera.setMode('action');
      } else if (shot === 'pause') {
        game.ui.setPauseVisible(true);
      } else if (shot === 'round_milestone') {
        // Park on the easy course's win round to show the payout card and HUD counter.
        game.waveManager.currentWaveIndex = game.waveManager.winRound;
        game.ui.showMilestone(getMilestone(game.waveManager.winRound, game.waveManager.winRound)!);
      } else if (shot === 'defeat') {
        game.waveManager.currentWaveIndex = 16;
        game.gameOver = true;
        // A staged report in which one member levels past the entry limit and graduates from the cup.
        const report = new MatchProgress(store);
        const cup = CUPS[game.map.cup];
        report.start(game.roster, cup);
        store.gainXp(game.roster[0], xpForLevel(cup.entryMax + 3) - game.roster[0].xp, cup.levelCap);
        game.ui.showDefeat(game.map.name, game.waveManager.round, game.waveManager.winRound, report.report());
      } else if (shot?.startsWith('capture_')) {
        // Stage a live capture attempt and step it to a chosen beat: the
        // release meter, the first wobble, the lock, or the trophy card after it.
        // Wait for the async GLB models first, or they swap in undimmed after
        // the frame has already been frozen.
        window.setTimeout(() => {
          c1.hp = c1.maxHp * 0.15;
          game.balls.ultra = 1;
          game.tryCapture(c1, 'ultra');
          const step = (frames: number) => {
            for (let frame = 0; frame < frames; frame++) game.update(1 / 60, input);
          };
          if (shot === 'capture_aim') {
            step(40);
          } else {
            // Sit in the aim window long enough for the cinematic camera to
            // actually arrive on its hero shot — it damps in at ~3/s, so a
            // shot that released immediately would judge every later beat's
            // framing from a camera still in transit.
            step(90);
            const realRandom = Math.random;
            const forceCatch = shot === 'capture_gotcha' || shot === 'capture_trophy'
              || shot === 'capture_lock';
            if (forceCatch) Math.random = () => 0; // Force the roll to succeed.
            // A break needs the opposite, and a high roll also picks the
            // late-wobble escape, which is the version worth looking at.
            if (shot === 'capture_break') Math.random = () => 0.99;
            game.activeCapture?.release();
            Math.random = realRandom;
            // Frames past the release, one per beat of the anime sheet: the
            // hit, the mid-air freeze, the tether drinking it in, the shell
            // slamming, the fall, then the wobble everything else waits on.
            const BEAT_FRAMES: Record<string, number> = {
              capture_strike: 28,
              capture_hang: 38,
              capture_beam: 57,
              capture_snap: 71,
              capture_suspend: 80,
              capture_break: 216,
              // The click itself, while the star is still on screen.
              capture_lock: 256,
              capture_gotcha: 292,
              capture_trophy: 460,
            };
            step(BEAT_FRAMES[shot!] ?? 150);
          }
          frozenShot = true;
        }, 1200);
      }
  }

  if (!shot || titleShot) {
    new TitleScreen(uiContainer, { settled: shot === 'title_screen' });
  }

  let lastTime = performance.now();

  function loop(currentTime: number) {
    const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
    lastTime = currentTime;

    if (!frozenShot) game.update(dt, input);
    game.render();
    input.update();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
});
