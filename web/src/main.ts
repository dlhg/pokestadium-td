/**
 * main.ts — PokéStadium TD Entry Point
 *
 * Boots the 3D colosseum canvas, input tracking, and master game loop.
 * Also includes automated scene-population for headless screenshot verification.
 */

import * as THREE from 'three';
import { StadiumTDGame } from './td/StadiumTDGame';
import { Input } from './engine/Input';
import { TOWER_TEMPLATES, Tower, TOWER_BASE_HEIGHT } from './td/Tower';
import { Creep } from './td/Creep';
import { STADIUM_MAPS } from './td/MapCatalog';
import { getMilestone } from './td/WaveManager';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('stadium-canvas') as HTMLCanvasElement;
  const uiContainer = document.getElementById('ui-overlay') as HTMLElement;

  if (!canvas || !uiContainer) {
    console.error('Missing canvas or UI overlay container!');
    return;
  }

  const game = new StadiumTDGame();
  game.init(canvas, uiContainer);

  const input = new Input(canvas);

  // Automated Headless Setup for Visual Verification
  const urlParams = new URLSearchParams(window.location.search);
  const shot = urlParams.get('shot');
  // A stepped shot holds its exact frame instead of drifting with real time.
  let frozenShot = false;

  if (shot) {
    game.announcer.setVoiceEnabled(false);
    uiContainer.classList.add('shot-mode');
  }
  const courseShot = STADIUM_MAPS.find(map => shot === `map_${map.id}`);
  if (courseShot) {
    game.loadMap(courseShot);
    game.announcer.update(60);
    game.isPaused = true;
  }

  if (shot && shot !== 'map_select' && !courseShot) {
    // Disable voice synthesis during headless screenshot capture
    game.announcer.setVoiceEnabled(false);
    game.loadMap(STADIUM_MAPS[0]);
    game.isPaused = true;

      // Populate battle scene for screenshots — free placement means these are
      // just open turf coordinates, chosen clear of the creep lane.
      const t0 = new Tower(TOWER_TEMPLATES.pikachu, new THREE.Vector3(-8, TOWER_BASE_HEIGHT, -6));
      game.renderer.scene.add(t0.group);
      game.towers.push(t0);

      const t1 = new Tower(TOWER_TEMPLATES.charizard, new THREE.Vector3(8, TOWER_BASE_HEIGHT, -6));
      t1.evolve(); // Charmeleon
      t1.evolve(); // Charizard!
      t1.buyUpgrade(0); // Flamethrower
      t1.buyUpgrade(0); // Fire Blast — unlocked by the final evolution
      t1.buyUpgrade(2); // Smokescreen
      game.renderer.scene.add(t1.group);
      game.towers.push(t1);

      const t3 = new Tower(TOWER_TEMPLATES.blastoise, new THREE.Vector3(0, TOWER_BASE_HEIGHT, 8));
      t3.evolve();
      t3.evolve(); // Blastoise!
      t3.buyUpgrade(1); // Bite
      t3.buyUpgrade(1); // Ice Beam
      game.renderer.scene.add(t3.group);
      game.towers.push(t3);

      if (shot === 'placement_preview') {
        // Hover open turf with Bulbasaur armed for placement so visual
        // verification captures both the side roster and its exact range.
        game.selectedTemplate = TOWER_TEMPLATES.venusaur;
        game.arena.group.updateMatrixWorld(true);
        game.camera.camera.updateMatrixWorld(true);
        const projected = new THREE.Vector3(-9, TOWER_BASE_HEIGHT, 6).project(game.camera.camera);
        input.mouseNDC.set(projected.x, projected.y);
      } else {
        // Select Pikachu to showcase the move shop: one line part-bought, one
        // untouched, and a top tier still locked behind evolution.
        t0.buyUpgrade(0); // Thunderbolt
        t0.buyUpgrade(2); // Thunder Wave
        t0.buyUpgrade(2); // Flash
        game.selectedTower = t0;
        t0.setSelected(true);
      }

      // Spawn creeps along the track
      const c1 = new Creep({
        id: 'demo_1',
        name: 'Rattata',
        type: 'Normal',
        maxHp: 100,
        speed: 4.0,
        reward: 15,
        modelType: 'rattata'
      }, game.arena.waypoints);
      c1.position.copy(game.arena.waypoints[8]);
      c1.group.position.copy(c1.position);
      game.renderer.scene.add(c1.group);
      game.creeps.push(c1);

      const c2 = new Creep({
        id: 'demo_2',
        name: 'Zubat',
        type: 'Poison',
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
      } else if (shot === 'action_cam') {
        game.camera.setMode('action');
      } else if (shot === 'round_milestone') {
        // Park on the easy course's win round to show the payout card and HUD counter.
        game.waveManager.currentWaveIndex = game.waveManager.winRound;
        game.ui.showMilestone(getMilestone(game.waveManager.winRound, game.waveManager.winRound)!);
      } else if (shot === 'defeat') {
        game.waveManager.currentWaveIndex = 16;
        game.gameOver = true;
        game.ui.showDefeat(game.map.name, game.waveManager.round, game.waveManager.winRound);
      } else if (shot?.startsWith('capture_')) {
        // Stage a live capture attempt and step it to a chosen beat: the
        // release meter, the first wobble, the lock, or the trophy card after it.
        // Wait for the async GLB models first, or they swap in undimmed after
        // the frame has already been frozen.
        window.setTimeout(() => {
          c1.hp = c1.maxHp * 0.15;
          game.balls.ultra = 1;
          game.ui.onSelectBall('ultra');
          game.tryCapture(c1);
          const step = (frames: number) => {
            for (let frame = 0; frame < frames; frame++) game.update(1 / 60, input);
          };
          if (shot === 'capture_aim') {
            step(40);
          } else {
            step(26); // Let the marker sweep partway before releasing.
            const realRandom = Math.random;
            const forceCatch = shot === 'capture_gotcha' || shot === 'capture_trophy';
            if (forceCatch) Math.random = () => 0; // Force the roll to succeed.
            game.activeCapture?.release();
            Math.random = realRandom;
            step(shot === 'capture_trophy' ? 460 : forceCatch ? 310 : 150);
          }
          frozenShot = true;
        }, 1200);
      }
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
