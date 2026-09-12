/**
 * StadiumArena.ts — 3D Pokémon Stadium Colosseum Environment
 *
 * Generates the iconic Pokémon Stadium arena:
 * - Central Poké Ball battle pitch with authentic graphics
 * - Winding 3D tactical lane with waypoints
 * - Free-placement build rules: arena bounds, lane clearance, keep-out zones
 * - Stadium grandstands, animated spectator crowd, and perimeter walls
 * - Floodlight towers and giant stadium jumbotrons
 */

import * as THREE from 'three';

/** Why the arena itself refuses a spot. `null` means the ground is clear. */
export type BuildBlockReason = 'out_of_bounds' | 'on_lane' | 'restricted' | null;

/** A circular region a map declares permanently off-limits for building. */
export interface NoBuildZone {
  x: number;
  z: number;
  radius: number;
  label: string;
}

export class StadiumArena {
  public group: THREE.Group = new THREE.Group();
  public waypoints: THREE.Vector3[] = [];

  /** Towers may be placed anywhere inside this radius of the pitch centre. */
  public readonly buildableRadius = 31;
  /** Half the creep lane's visual width — a footprint must clear it entirely. */
  private readonly laneHalfWidth = 1.6;
  /** Map-authored keep-out regions. The colosseum declares none. */
  private noBuildZones: NoBuildZone[] = [];
  /** Densely sampled lane centreline, used for clearance tests. */
  private pathSamples: THREE.Vector3[] = [];

  private environmentGroup = new THREE.Group();
  private gameplayGroup = new THREE.Group();
  private noBuildGroup = new THREE.Group();

  // Jumbotron dynamic canvas textures
  private jumbotronCanvas: HTMLCanvasElement;
  private jumbotronCtx: CanvasRenderingContext2D;
  private jumbotronTexture: THREE.CanvasTexture;

  constructor() {
    this.environmentGroup.name = 'arena-environment';
    this.gameplayGroup.name = 'tower-defense-overlay';
    this.noBuildGroup.name = 'no-build-zones';
    this.gameplayGroup.add(this.noBuildGroup);
    this.group.add(this.environmentGroup, this.gameplayGroup);
    this.jumbotronCanvas = document.createElement('canvas');
    this.jumbotronCanvas.width = 512;
    this.jumbotronCanvas.height = 256;
    this.jumbotronCtx = this.jumbotronCanvas.getContext('2d')!;
    this.jumbotronTexture = new THREE.CanvasTexture(this.jumbotronCanvas);

    this.initArena();
    this.initWaypoints();
    // Sampled once: every placement test measures against these points, and the
    // spacing (~0.6 units) bounds how far a footprint can cheat toward the lane.
    this.pathSamples = this.createPathCurve().getPoints(240);
  }

  private initArena(): void {
    // 1. Stadium Ground Turf
    const groundGeo = new THREE.CylinderGeometry(36, 36, 1.2, 48);
    const groundMat = new THREE.MeshLambertMaterial({
      color: 0x1a472a, // Deep stadium grass green
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -0.6;
    ground.receiveShadow = true;
    this.environmentGroup.add(ground);

    // 2. Central Poké Ball Battle Pitch (Canvas Texture)
    const pitchCanvas = document.createElement('canvas');
    pitchCanvas.width = 1024;
    pitchCanvas.height = 1024;
    const ctx = pitchCanvas.getContext('2d')!;

    // Outer turf circle
    ctx.fillStyle = '#2d6a4f';
    ctx.beginPath();
    ctx.arc(512, 512, 500, 0, Math.PI * 2);
    ctx.fill();

    // White outer boundary line
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 14;
    ctx.stroke();

    // Giant Poké Ball Emblem
    // Top half: Stadium Red
    ctx.fillStyle = '#d90429';
    ctx.beginPath();
    ctx.arc(512, 512, 380, Math.PI, 0, false);
    ctx.fill();

    // Bottom half: Crisp White
    ctx.fillStyle = '#f8f9fa';
    ctx.beginPath();
    ctx.arc(512, 512, 380, 0, Math.PI, false);
    ctx.fill();

    // Black center dividing stripe
    ctx.fillStyle = '#111111';
    ctx.fillRect(512 - 380, 512 - 28, 760, 56);

    // Center Outer Ring (Black)
    ctx.beginPath();
    ctx.arc(512, 512, 110, 0, Math.PI * 2);
    ctx.fill();

    // Center Inner Ring (White)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(512, 512, 70, 0, Math.PI * 2);
    ctx.fill();

    // Inner Button (Light Cyan/White sheen)
    ctx.fillStyle = '#e2eafc';
    ctx.beginPath();
    ctx.arc(512, 512, 45, 0, Math.PI * 2);
    ctx.fill();

    const pitchTex = new THREE.CanvasTexture(pitchCanvas);
    pitchTex.anisotropy = 8;
    const pitchMat = new THREE.MeshLambertMaterial({
      map: pitchTex,
    });
    const pitchMesh = new THREE.Mesh(new THREE.CircleGeometry(24, 48), pitchMat);
    pitchMesh.rotation.x = -Math.PI / 2;
    pitchMesh.position.y = 0.02;
    pitchMesh.receiveShadow = true;
    this.environmentGroup.add(pitchMesh);

    // 3. Creep Track Visuals (Winding Dirt Path)
    this.buildTrackPath();

    // 4. Perimeter Colosseum Walls & Barriers
    const wallGeo = new THREE.CylinderGeometry(36, 36, 3.5, 48, 1, true);
    const wallMat = new THREE.MeshLambertMaterial({
      color: 0x0a3871, // Stadium metallic blue
      side: THREE.BackSide,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 1.75;
    this.environmentGroup.add(wall);

    // Glowing stadium neon barrier strip
    const neonGeo = new THREE.TorusGeometry(35.9, 0.25, 8, 48);
    const neonMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const neon = new THREE.Mesh(neonGeo, neonMat);
    neon.rotation.x = Math.PI / 2;
    neon.position.y = 3.4;
    this.environmentGroup.add(neon);

    // 5. Tiered Grandstands with Stadium Crowds
    this.buildGrandstands();

    // 6. Corner Floodlight Towers
    this.buildFloodlightTowers();

    // 7. Giant Stadium Jumbotrons (North & South)
    this.buildJumbotrons();
  }

  private createPathCurve(): THREE.CatmullRomCurve3 {
    // A perimeter route keeps the native battle floor readable and leaves a
    // coherent central build zone. The ends sit outside opposite arena gates.
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(-27, 0.5, -18),
      new THREE.Vector3(-20, 0.5, -18),
      new THREE.Vector3(-16, 0.5, -10),
      new THREE.Vector3(-20, 0.5, 0),
      new THREE.Vector3(-16, 0.5, 10),
      new THREE.Vector3(-8, 0.5, 17),
      new THREE.Vector3(0, 0.5, 20),
      new THREE.Vector3(8, 0.5, 17),
      new THREE.Vector3(16, 0.5, 10),
      new THREE.Vector3(20, 0.5, 0),
      new THREE.Vector3(16, 0.5, -10),
      new THREE.Vector3(20, 0.5, -18),
      new THREE.Vector3(27, 0.5, -18),
    ], false, 'centripetal');
  }

  private buildTrackPath(): void {
    // Generate curved path ribbon around the waypoints
    const curve = this.createPathCurve();
    const curvePoints = curve.getPoints(100);

    // Build ribbon strip
    const stripGeo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const colors: number[] = [];
    const width = 3.2;

    for (let i = 0; i < curvePoints.length - 1; i++) {
      const p1 = curvePoints[i];
      const p2 = curvePoints[i + 1];
      const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
      const normal = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2);

      const v1 = new THREE.Vector3().addVectors(p1, normal);
      const v2 = new THREE.Vector3().subVectors(p1, normal);
      const v3 = new THREE.Vector3().addVectors(p2, normal);
      const v4 = new THREE.Vector3().subVectors(p2, normal);

      // Triangle 1
      positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
      // Triangle 2
      positions.push(v2.x, v2.y, v2.z, v4.x, v4.y, v4.z, v3.x, v3.y, v3.z);

      // Dirt color with subtle checker
      const c = (i % 4 === 0) ? 0.65 : 0.72;
      for (let k = 0; k < 6; k++) {
        colors.push(c * 0.85, c * 0.72, c * 0.52);
      }
    }

    stripGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    stripGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    stripGeo.computeVertexNormals();

    const trackMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    const trackMesh = new THREE.Mesh(stripGeo, trackMat);
    trackMesh.receiveShadow = true;
    this.gameplayGroup.add(trackMesh);
  }

  private buildGrandstands(): void {
    // 3 tiers of stadium seating
    const tiers = [
      { rInner: 36, rOuter: 42, y: 3.5, height: 3 },
      { rInner: 42, rOuter: 48, y: 6.5, height: 4 },
      { rInner: 48, rOuter: 56, y: 10.5, height: 5 },
    ];

    tiers.forEach((t) => {
      const standGeo = new THREE.RingGeometry(t.rInner, t.rOuter, 36);
      const standMat = new THREE.MeshLambertMaterial({
        color: 0x22334d,
        side: THREE.DoubleSide,
      });
      const stand = new THREE.Mesh(standGeo, standMat);
      stand.rotation.x = -Math.PI / 2;
      stand.position.y = t.y;
      this.environmentGroup.add(stand);

      // Low-poly cheering crowd blocks
      const crowdCount = 120;
      const crowdGeo = new THREE.BoxGeometry(0.8, 1.2, 0.8);
      const crowdColors = [0xd62828, 0x00f0ff, 0xffd166, 0x06d6a0, 0xffffff];

      for (let i = 0; i < crowdCount; i++) {
        const angle = (i / crowdCount) * Math.PI * 2;
        const radius = t.rInner + 1.5 + Math.random() * (t.rOuter - t.rInner - 2.5);
        const col = crowdColors[Math.floor(Math.random() * crowdColors.length)];
        const personMat = new THREE.MeshBasicMaterial({ color: col });
        const person = new THREE.Mesh(crowdGeo, personMat);
        person.position.set(
          Math.cos(angle) * radius,
          t.y + 0.6,
          Math.sin(angle) * radius
        );
        this.environmentGroup.add(person);
      }
    });
  }

  private buildFloodlightTowers(): void {
    const corners = [
      { x: -28, z: -28 },
      { x: 28, z: -28 },
      { x: 28, z: 28 },
      { x: -28, z: 28 },
    ];

    corners.forEach(c => {
      // Truss pylon pole
      const pylonGeo = new THREE.CylinderGeometry(0.6, 1.2, 32, 8);
      const pylonMat = new THREE.MeshStandardMaterial({
        color: 0x556677,
        metalness: 0.8,
        roughness: 0.3,
      });
      const pylon = new THREE.Mesh(pylonGeo, pylonMat);
      pylon.position.set(c.x, 16, c.z);
      this.environmentGroup.add(pylon);

      // Spotlight head cluster
      const headGeo = new THREE.BoxGeometry(4, 2.5, 2);
      const headMat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        metalness: 0.9,
      });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(c.x, 32, c.z);
      head.lookAt(0, 0, 0);

      // Glowing lens surfaces
      const lensGeo = new THREE.PlaneGeometry(3.6, 2.1);
      const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.z = 1.01;
      head.add(lens);

      this.environmentGroup.add(head);
    });
  }

  private buildJumbotrons(): void {
    const screens = [
      { z: -38, rotY: 0 },
      { z: 38, rotY: Math.PI },
    ];

    screens.forEach(s => {
      const frameGeo = new THREE.BoxGeometry(18, 9, 1.5);
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x111b24 });
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.position.set(0, 16, s.z);
      frame.rotation.y = s.rotY;

      const screenGeo = new THREE.PlaneGeometry(16.5, 7.5);
      const screenMat = new THREE.MeshBasicMaterial({
        map: this.jumbotronTexture,
      });
      const screen = new THREE.Mesh(screenGeo, screenMat);
      screen.position.z = 0.8;
      frame.add(screen);

      this.environmentGroup.add(frame);
    });

    this.updateJumbotron("POKÉMON STADIUM", "TOURNAMENT CUP: POKE CUP", 1);
  }

  public updateJumbotron(title: string, subtitle: string, wave: number): void {
    const ctx = this.jumbotronCtx;
    const w = this.jumbotronCanvas.width;
    const h = this.jumbotronCanvas.height;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#041226');
    grad.addColorStop(1, '#0b325e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Neon borders
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, w - 10, h - 10);

    // Title
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 44px Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, w / 2, 80);

    // Subtitle
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px Rajdhani, sans-serif';
    ctx.fillText(subtitle, w / 2, 140);

    // Live wave badge
    ctx.fillStyle = '#d62828';
    ctx.fillRect(w / 2 - 100, 175, 200, 48);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(w / 2 - 100, 175, 200, 48);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Impact, sans-serif';
    ctx.fillText(`ROUND ${wave}`, w / 2, 210);

    this.jumbotronTexture.needsUpdate = true;
  }

  private initWaypoints(): void {
    this.waypoints = this.createPathCurve().getPoints(72);
  }

  /**
   * Arena-side placement test for a footprint of `radius` centred on (x, z).
   * Tower-versus-tower crowding is the game's concern, not the arena's.
   */
  public isBuildable(x: number, z: number, radius: number): BuildBlockReason {
    if (Math.hypot(x, z) > this.buildableRadius - radius) return 'out_of_bounds';

    const laneClearance = this.laneHalfWidth + radius;
    for (const point of this.pathSamples) {
      if (Math.hypot(x - point.x, z - point.z) < laneClearance) return 'on_lane';
    }

    for (const zone of this.noBuildZones) {
      if (Math.hypot(x - zone.x, z - zone.z) < zone.radius + radius) return 'restricted';
    }

    return null;
  }

  public getNoBuildZones(): readonly NoBuildZone[] {
    return this.noBuildZones;
  }

  /** Replaces the map's keep-out regions along with their on-field markings. */
  public setNoBuildZones(zones: NoBuildZone[]): void {
    this.noBuildZones = zones;

    this.noBuildGroup.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    this.noBuildGroup.clear();

    zones.forEach((zone) => {
      const marker = new THREE.Mesh(
        new THREE.CircleGeometry(zone.radius, 40),
        new THREE.MeshBasicMaterial({
          color: 0xd90429,
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(zone.x, 0.04, zone.z);
      marker.renderOrder = 3;
      this.noBuildGroup.add(marker);
    });
  }
}
