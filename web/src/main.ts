/**
 * main.ts — PokéStadium TD Entry Point
 *
 * Boots the 3D colosseum canvas, input tracking, and master game loop.
 * Also includes automated scene-population for headless screenshot verification.
 */

import { StadiumTDGame } from './td/StadiumTDGame';
import { Input } from './engine/Input';
import { TOWER_TEMPLATES, Tower } from './td/Tower';
import { Creep } from './td/Creep';

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

  if (shot) {
    // Disable voice synthesis during headless screenshot capture
    game.announcer.setVoiceEnabled(false);

      // Populate battle scene for screenshots
      const ped0 = game.arena.pedestals[0];
      const t0 = new Tower(TOWER_TEMPLATES.pikachu, ped0.id, ped0.position);
      game.renderer.scene.add(t0.group);
      game.towers.push(t0);
      ped0.occupied = true;
      ped0.towerId = t0.id;

      // Charizard on pedestal 1
      const ped1 = game.arena.pedestals[1];
      const t1 = new Tower(TOWER_TEMPLATES.charizard, ped1.id, ped1.position);
      t1.upgrade(); // Charmeleon
      t1.upgrade(); // Charizard!
      game.renderer.scene.add(t1.group);
      game.towers.push(t1);
      ped1.occupied = true;
      ped1.towerId = t1.id;

      // Blastoise on pedestal 3
      const ped3 = game.arena.pedestals[3];
      const t3 = new Tower(TOWER_TEMPLATES.blastoise, ped3.id, ped3.position);
      t3.upgrade();
      t3.upgrade(); // Blastoise!
      game.renderer.scene.add(t3.group);
      game.towers.push(t3);
      ped3.occupied = true;
      ped3.towerId = t3.id;

      // Select Pikachu to showcase the Stadium Radial Command Wheel!
      game.selectedTower = t0;
      t0.setSelected(true);

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
        modelType: 'boss_titan',
        titanType: 'Onix'
      }, game.arena.waypoints);
      c3.position.copy(game.arena.waypoints[4]);
      c3.group.position.copy(c3.position);
      game.renderer.scene.add(c3.group);
      game.creeps.push(c3);

      if (shot === 'stadium_overview') {
        game.camera.setMode('stadium');
      } else if (shot === 'action_cam') {
        game.camera.setMode('action');
      }
  }

  let lastTime = performance.now();

  function loop(currentTime: number) {
    const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
    lastTime = currentTime;

    game.update(dt, input);
    game.render();
    input.update();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
});
