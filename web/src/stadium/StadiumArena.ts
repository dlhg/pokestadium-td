/**
 * StadiumArena.ts — 3D Pokémon Stadium Colosseum Environment
 *
 * Renders authored tower-defense courses inside the Pokémon Stadium arena:
 * - Themed terrain, water, bridges and low-poly placement obstacles
 * - Map-specific lanes sharing geometry with navigation and placement tests
 * - Free-placement build rules: arena bounds, lane clearance, keep-out zones
 * - Stadium grandstands, animated spectator crowd, and perimeter walls
 * - Giant stadium jumbotron
 */

import * as THREE from 'three';
import { DEFAULT_STADIUM_MAP, type MapObstacle, type StadiumMap } from '../td/MapCatalog';
import { bridgeAt, buildLaneRibbon, liftRoutesOverBridges, mapBuildBlock, sampleMapRoutes, type MapBuildBlock } from '../td/MapGeometry';
import { LANE_RIDE_HEIGHT, MapTerrain } from '../td/MapTerrain';
import { buildMapGround, buildMapObstacle, disposeScenery, maskGroundProps } from './MapScenery';
import { StadiumBackdrop } from './StadiumBackdrop';

export type BuildBlockReason = MapBuildBlock;
export type NoBuildZone = MapObstacle;

type CrowdMember = {
  atlasSet: number;
  character: number;
  phase: number;
  position: THREE.Vector3;
  facing: number;
  scale: number;
};

/** No-show rate re-rolled per match so the stands never look identical twice. */
const EMPTY_SEAT_RATE_MIN = 0.08;
const EMPTY_SEAT_RATE_MAX = 0.15;

type CrowdBatch = {
  atlasCell: THREE.InstancedBufferAttribute;
  tension: THREE.InstancedBufferAttribute;
  mesh: THREE.InstancedMesh;
  members: CrowdMember[];
};

export class StadiumArena {
  public group: THREE.Group = new THREE.Group();
  public waypoints: THREE.Vector3[] = [];
  public routes: THREE.Vector3[][] = [];
  /** Routes as creeps walk them: raised onto bridge decks. */
  public walkRoutes: THREE.Vector3[][] = [];
  /** Per walk point, the height added by a bridge deck (no stair slowdown). */
  public walkLifts: number[][] = [];

  /** Towers may be placed anywhere inside this radius of the pitch centre. */
  public readonly buildableRadius: number;
  public readonly map: StadiumMap;
  /** Ground heights shared by rendering, movement, placement and picking. */
  public readonly terrain: MapTerrain;
  private environmentGroup = new THREE.Group();
  private gameplayGroup = new THREE.Group();
  private noBuildGroup = new THREE.Group();
  private backdrop: StadiumBackdrop;

  // Jumbotron dynamic canvas textures
  private jumbotronCanvas: HTMLCanvasElement;
  private jumbotronCtx: CanvasRenderingContext2D;
  private jumbotronTexture: THREE.CanvasTexture;
  private jumbotronSignature = '';
  private jumbotronFrame: THREE.Mesh | null = null;
  private jumbotronFeedTarget: THREE.WebGLRenderTarget;
  private crowdMaterial: THREE.ShaderMaterial | null = null;
  private crowdMood: number = 0;
  private targetCrowdMood: number = 0;
  private crowdTension = false;
  private crowdBatches: CrowdBatch[] = [];
  private groundPropMask = '';
  /** Re-rolled per arena instance so empty seats land somewhere new each level. */
  private emptySeatRate: number = EMPTY_SEAT_RATE_MIN + Math.random() * (EMPTY_SEAT_RATE_MAX - EMPTY_SEAT_RATE_MIN);

  constructor(map: StadiumMap = DEFAULT_STADIUM_MAP) {
    this.map = map;
    this.buildableRadius = map.buildableRadius;
    this.routes = sampleMapRoutes(map);
    this.terrain = new MapTerrain(map, this.routes);
    ({ routes: this.walkRoutes, lifts: this.walkLifts } = liftRoutesOverBridges(map, this.routes, this.terrain));
    this.waypoints = this.walkRoutes[0];
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
    this.jumbotronFeedTarget = new THREE.WebGLRenderTarget(640, 320, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.backdrop = new StadiumBackdrop(map);

    this.initArena();
    this.setNoBuildZones(map.obstacles);
  }

  private initArena(): void {
    this.environmentGroup.add(this.backdrop.group);
    this.environmentGroup.add(new THREE.HemisphereLight(0xe6f1ff, 0x647557, 1.1));
    this.environmentGroup.add(buildMapGround(this.map,this.terrain,this.routes));
    this.buildTrackPath();
    this.buildGrandstands();
    this.buildJumbotron();

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(35.6,35.6,1.1,64,1,true),
      new THREE.MeshLambertMaterial({color:0x233e5c,side:THREE.DoubleSide})
    );
    wall.position.y=0.3;
    this.environmentGroup.add(wall);
    const neon = new THREE.Mesh(new THREE.TorusGeometry(35.6,0.12,6,64),new THREE.MeshBasicMaterial({color:this.map.palette.accent}));
    neon.rotation.x=Math.PI/2;
    neon.position.y=0.85;
    this.environmentGroup.add(neon);
  }

  private buildTrackPath(): void {
    this.routes.forEach((points, routeIndex) => {
      // Swept ribbon with tapered inner corners; all routes use
      // exactly the same sampled points as movement and placement collision.
      // Break the ribbon where a bridge deck carries the lane; its ends tuck under the planks.
      const runs: THREE.Vector3[][] = [[]];
      for (const point of points) {
        if (bridgeAt(this.map,point.x,point.z,0.6)) { if (runs[runs.length-1].length) runs.push([]); }
        else runs[runs.length-1].push(point);
      }
      for (const run of runs.filter(run => run.length > 1)) for (const edge of [true,false]) {
        const halfWidth=this.map.laneWidth/2+(edge?0.22:0);
        const geometry=buildLaneRibbon(run,halfWidth,edge?0.12:0.14);
        const track=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({color:edge?this.map.palette.edge:this.map.palette.path,side:THREE.DoubleSide}));
        track.receiveShadow=true;track.name=`route-${routeIndex}-${edge?'edge':'lane'}`;
        this.gameplayGroup.add(track);
      }
      // Direction chevrons make the winding and crossing routes legible.
      for(let i=8;i<points.length-8;i+=28) {
        const point=points[i], next=points[i+2];
        if (bridgeAt(this.map,point.x,point.z)) continue;
        const shape=new THREE.Shape();
        shape.moveTo(-0.65,0.38);shape.lineTo(0, -0.38);shape.lineTo(0.65,0.38);
        shape.lineTo(0.65,0.05);shape.lineTo(0,-0.7);shape.lineTo(-0.65,0.05);shape.closePath();
        const arrow=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color:this.map.theme==='industrial'?(routeIndex?'#66cee5':'#f9d578'):this.map.palette.edge,side:THREE.DoubleSide}));
        arrow.rotation.x=-Math.PI/2;
        arrow.rotation.z=Math.atan2(next.x-point.x,next.z-point.z);
        arrow.position.set(point.x,point.y+0.05,point.z);
        this.gameplayGroup.add(arrow);
      }
    });
    if (this.map.showGates === false) return;
    // Routes that meet at one endpoint share one gate and one label.
    // Average their approach directions so the shared gate faces both lanes.
    for (const entry of [true, false]) {
      const gates: { point: THREE.Vector3; direction: THREE.Vector3 }[] = [];
      for (const points of this.routes) {
        const point = points[entry ? 0 : points.length-1];
        const adjacent = points[entry ? 1 : points.length-2];
        const direction = adjacent.clone().sub(point).setY(0).normalize();
        const shared = gates.find(gate => gate.point.distanceToSquared(point) < 0.0001);
        if (shared) shared.direction.add(direction);
        else gates.push({ point, direction });
      }
      gates.forEach((gate,index) => this.addGate(gate.point, gate.point.clone().add(gate.direction),
        entry, gates.length > 1 ? index+1 : undefined));
    }
  }

  private addGate(point: THREE.Vector3, adjacent: THREE.Vector3, entry: boolean, number?: number): void {
    const gate=new THREE.Group();
    gate.position.set(point.x,point.y-LANE_RIDE_HEIGHT,point.z);
    gate.rotation.y=Math.atan2(adjacent.x-point.x,adjacent.z-point.z);
    const color=entry?'#90dfae':'#ff9579';
    const mat=new THREE.MeshLambertMaterial({color:0x233f56});
    for(const side of [-1,1]) {
      const post=new THREE.Mesh(new THREE.BoxGeometry(0.55,2.7,0.55),mat);
      post.position.set(side*(this.map.laneWidth/2+0.4),1.35,0);gate.add(post);
    }
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#152f47';ctx.fillRect(0,0,256,64);
    ctx.strokeStyle=color;ctx.lineWidth=5;ctx.strokeRect(3,3,250,58);
    ctx.fillStyle=color;ctx.font='bold 36px sans-serif';ctx.textAlign='center';
    ctx.fillText(`${entry?'IN':'OUT'}${number === undefined ? '' : ' '+number}`,128,46);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:texture}));
    sign.scale.set(4.3,1.1,1);sign.position.y=3;gate.add(sign);
    this.gameplayGroup.add(gate);
  }

  private buildGrandstands(): void {
    // The crowd art is intentionally alpha-cutout, and the stepped tiers have
    // open air between their structural levels. Give the entire bowl a solid
    // architectural back so a bright venue sky never shows through spectators
    // or reads as transparent seating.
    const bowlBacking = new THREE.Mesh(
      // The lower extent is deliberately deep: from an elevated camera, a ray
      // through the front row continues downward before reaching the far outer
      // wall. A shallow facade therefore still exposes the sky beneath tier 1.
      new THREE.CylinderGeometry(56.35, 56.35, 70, 64, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x101d30, side: THREE.DoubleSide }),
    );
    bowlBacking.position.y = -16;
    bowlBacking.receiveShadow = true;
    bowlBacking.name = 'opaque-grandstand-backing';
    this.environmentGroup.add(bowlBacking);

    const upperRim = new THREE.Mesh(
      new THREE.TorusGeometry(56.3, 0.42, 6, 64),
      new THREE.MeshLambertMaterial({ color: 0x6f8297 }),
    );
    upperRim.rotation.x = Math.PI / 2;
    upperRim.position.y = 19;
    upperRim.name = 'grandstand-upper-rim';
    this.environmentGroup.add(upperRim);

    // 3 tiers of stadium seating
    const tiers = [
      { rInner: 36, rOuter: 42, y: 3.5, height: 3 },
      { rInner: 42, rOuter: 48, y: 6.5, height: 4 },
      { rInner: 48, rOuter: 56, y: 10.5, height: 5 },
    ];

    tiers.forEach((t) => {
      this.addBleacherTier(t);
      this.addCrowdTier(t);
    });
  }

  /** Builds shallow stepped seating with a low fascia masking each card's waist. */
  private addBleacherTier(tier: { rInner: number; rOuter: number; y: number; height: number }): void {
    const rows = this.crowdRowCount(tier);
    const rowDepth = (tier.rOuter - tier.rInner) / rows;
    const rowRise = 0.42;
    const treadMaterials = [0x263b55, 0x20334b].map(color => new THREE.MeshLambertMaterial({
      color,
      side: THREE.DoubleSide,
    }));
    const fasciaMaterial = new THREE.MeshLambertMaterial({ color: 0x17283d, side: THREE.DoubleSide });
    const railMaterial = new THREE.MeshBasicMaterial({ color: 0x58718e });

    for (let row = 0; row < rows; row++) {
      const inner = tier.rInner + row * rowDepth;
      const outer = inner + rowDepth;
      const seatY = tier.y + row * rowRise;
      const tread = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 64),
        treadMaterials[row % treadMaterials.length],
      );
      tread.rotation.x = -Math.PI / 2;
      tread.position.y = seatY;
      tread.name = 'bleacher-tread';
      this.environmentGroup.add(tread);

      // The fascia sits between the match and the spectator. Besides making
      // the stands read as real stepped bleachers, it hides the flat bottom
      // of the waist-up artwork behind a deliberate architectural edge.
      const fascia = new THREE.Mesh(
        new THREE.CylinderGeometry(inner, inner, 0.44, 64, 1, true),
        fasciaMaterial,
      );
      fascia.position.y = seatY + 0.22;
      fascia.name = 'bleacher-front-fascia';
      this.environmentGroup.add(fascia);

      const rail = new THREE.Mesh(new THREE.TorusGeometry(inner, 0.055, 4, 64), railMaterial);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = seatY + 0.45;
      rail.name = 'bleacher-front-rail';
      this.environmentGroup.add(rail);
    }
  }

  private crowdRowCount(tier: { rInner: number; rOuter: number }): number {
    return Math.max(3, Math.round((tier.rOuter - tier.rInner) / 2));
  }

  /**
   * The crowd is a single instanced card draw, not hundreds of individual
   * materials.  Each instance chooses a cell from the 8 x 4 character atlas
   * and has a different cheer phase so the stands do not bob in lockstep.
   */
  private addCrowdTier(tier: { rInner: number; rOuter: number; y: number; height: number }): void {
    const rows = this.crowdRowCount(tier);
    const rowDepth = (tier.rOuter - tier.rInner) / rows;
    const rowRise = 0.42;
    // Seat by circumference so outer rows pack as tightly as the front ones.
    // A card is ~1.7 units wide, so this spacing lets shoulders just overlap.
    const seatSpacing = 1.3;
    const rowRadius = (row: number) => tier.rInner + row * rowDepth + 0.58;
    const seatsPerRow = Array.from({ length: rows }, (_, row) =>
      Math.round((Math.PI * 2 * rowRadius(row)) / seatSpacing));
    const crowdCount = seatsPerRow.reduce((sum, seats) => sum + seats, 0);
    const geometry = new THREE.PlaneGeometry(1.9, 1.9);
    const atlasCell = new Float32Array(crowdCount * 2);
    const cheerPhase = new Float32Array(crowdCount);
    const tint = new Float32Array(crowdCount * 3);
    const atlasSet = new Float32Array(crowdCount);
    const tension = new Float32Array(crowdCount);
    const members: CrowdMember[] = [];
    const mesh = new THREE.InstancedMesh(geometry, this.getCrowdMaterial(), crowdCount);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0, row = 0, placeInRow = 0; i < crowdCount; i++, placeInRow++) {
      if (placeInRow >= seatsPerRow[row]) { row++; placeInRow = 0; }
      const seed = this.crowdNoise(i + tier.rInner * 10);
      const seatAngle = (Math.PI * 2) / seatsPerRow[row];
      const angle = (placeInRow + (row % 2) * 0.5) * seatAngle + (seed - 0.5) * seatAngle * 0.25;
      const radius = rowRadius(row) + (seed - 0.5) * 0.16;
      const seatY = tier.y + row * rowRise;
      dummy.position.set(Math.cos(angle) * radius, seatY + 0.92, Math.sin(angle) * radius);
      dummy.lookAt(0, dummy.position.y, 0);
      // A few seats are empty each match; scaling the card to nothing hides it
      // without disturbing the instance count or the row/seat layout math.
      const isEmpty = Math.random() < this.emptySeatRate;
      const scale = isEmpty ? 0 : 0.78 + this.crowdNoise(i * 7 + tier.y) * 0.2;
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // The generated atlas is 8 columns x 4 rows. Flip the authored row for
      // WebGL UV origin so index zero corresponds to the top-left character.
      const character = Math.floor(this.crowdNoise(i * 13 + tier.y * 2) * 20);
      const phase = this.crowdNoise(i * 19 + tier.rOuter) * Math.PI * 2;
      // Temporary front / idle coordinates; updateCrowdCards assigns the
      // camera-correct direction and current animation frame every tick.
      atlasCell[i * 2] = (character % 4) % 2 * 4;
      atlasCell[i * 2 + 1] = 3 - (Math.floor((character % 4) / 2) * 2);
      atlasSet[i] = Math.floor(character / 4);
      cheerPhase[i] = phase;
      members.push({
        atlasSet: atlasSet[i],
        character: character % 4,
        phase,
        position: dummy.position.clone(),
        facing: Math.atan2(-dummy.position.x, -dummy.position.z),
        scale,
      });
      color.setRGB(0.72 + seed * 0.22, 0.72 + seed * 0.22, 0.78 + seed * 0.16);
      tint.set([color.r, color.g, color.b], i * 3);
    }

    geometry.setAttribute('atlasCell', new THREE.InstancedBufferAttribute(atlasCell, 2));
    geometry.setAttribute('cheerPhase', new THREE.InstancedBufferAttribute(cheerPhase, 1));
    geometry.setAttribute('crowdTint', new THREE.InstancedBufferAttribute(tint, 3));
    geometry.setAttribute('atlasSet', new THREE.InstancedBufferAttribute(atlasSet, 1));
    geometry.setAttribute('crowdTension', new THREE.InstancedBufferAttribute(tension, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = 'instanced-sprite-crowd';
    this.crowdBatches.push({
      atlasCell: geometry.getAttribute('atlasCell') as THREE.InstancedBufferAttribute,
      tension: geometry.getAttribute('crowdTension') as THREE.InstancedBufferAttribute,
      mesh,
      members,
    });
    this.environmentGroup.add(mesh);
  }

  private getCrowdMaterial(): THREE.ShaderMaterial {
    if (this.crowdMaterial) return this.crowdMaterial;
    const loader = new THREE.TextureLoader();
    const atlases = [1, 2, 3, 4, 5].map((index) => {
      const atlas = loader.load(`/crowd/turnaround-crowd-0${index}.png`);
      atlas.colorSpace = THREE.SRGBColorSpace;
      // Sprite sheets have no painted cell borders. Nearest sampling plus no
      // mip levels and the UV inset below guarantee a neighbour never leaks
      // into a character at distance.
      atlas.magFilter = THREE.NearestFilter;
      atlas.minFilter = THREE.NearestFilter;
      atlas.generateMipmaps = false;
      return atlas;
    });
    const tensionAtlas = loader.load('/crowd/turnaround-crowd-tension.png');
    tensionAtlas.colorSpace = THREE.SRGBColorSpace;
    tensionAtlas.magFilter = THREE.NearestFilter;
    tensionAtlas.minFilter = THREE.NearestFilter;
    tensionAtlas.generateMipmaps = false;
    this.crowdMaterial = new THREE.ShaderMaterial({
      uniforms: {
        atlas0: { value: atlases[0] }, atlas1: { value: atlases[1] }, atlas2: { value: atlases[2] },
        atlas3: { value: atlases[3] }, atlas4: { value: atlases[4] },
        tensionAtlas: { value: tensionAtlas }, time: { value: 0 },
        // -1 hushes the stands to stillness, +1 whips them into a roar.
        mood: { value: 0 },
      },
      vertexShader: `
        attribute vec2 atlasCell;
        attribute float cheerPhase;
        attribute vec3 crowdTint;
        attribute float atlasSet;
        attribute float crowdTension;
        uniform float time;
        uniform float mood;
        varying vec2 vAtlasUv;
        varying vec2 vTensionUv;
        varying vec3 vTint;
        varying float vAtlasSet;
        varying float vCrowdTension;
        void main() {
          vec3 animatedPosition = position;
          // Keep the waist planted behind the fascia while the shoulders and
          // head carry the cheer motion. This removes the sliding paper-card
          // seam where the artwork meets the seat.
          float upperBody = smoothstep(-0.82, 0.28, position.y);
          // A hush stills the stands; a roar makes them bounce out of their seats.
          float energy = clamp(1.0 + mood, 0.06, 2.6);
          float rate = 5.0 + mood * 3.0;
          animatedPosition.y += sin(time * rate + cheerPhase) * 0.065 * upperBody * energy;
          animatedPosition.x += sin(time * 2.5 + cheerPhase) * 0.016 * upperBody * energy;
          // Four pixel inset inside each 224px cell prevents transparent-edge
          // filtering from sampling art in a neighbouring cell.
          vec2 cellSize = vec2(1.0 / 8.0, 1.0 / 4.0);
          vec2 inset = vec2(4.0 / 1774.0, 4.0 / 887.0);
          vAtlasUv = atlasCell * cellSize + inset + uv * (cellSize - 2.0 * inset);
          // The tension texture is a single 20 x 4 sheet: atlas set chooses
          // one 4-column band, while the old cell position supplies view and
          // character. Its Y coordinate follows the same flipped WebGL layout.
          float characterRow = 3.0 - atlasCell.y + floor(atlasCell.x / 4.0);
          vec2 tensionCell = vec2(atlasSet * 4.0 + mod(atlasCell.x, 4.0), 3.0 - characterRow);
          vec2 tensionCellSize = vec2(1.0 / 20.0, 1.0 / 4.0);
          vec2 tensionInset = vec2(4.0 / 4000.0, 4.0 / 800.0);
          vTensionUv = tensionCell * tensionCellSize + tensionInset + uv * (tensionCellSize - 2.0 * tensionInset);
          vTint = crowdTint;
          vAtlasSet = atlasSet;
          vCrowdTension = crowdTension;
          vec4 worldPosition = modelMatrix * instanceMatrix * vec4(animatedPosition, 1.0);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D atlas0;
        uniform sampler2D atlas1;
        uniform sampler2D atlas2;
        uniform sampler2D atlas3;
        uniform sampler2D atlas4;
        uniform sampler2D tensionAtlas;
        varying vec2 vAtlasUv;
        varying vec2 vTensionUv;
        varying vec3 vTint;
        varying float vAtlasSet;
        varying float vCrowdTension;
        void main() {
          vec4 sprite = texture2D(atlas0, vAtlasUv);
          if (vAtlasSet > 0.5 && vAtlasSet < 1.5) sprite = texture2D(atlas1, vAtlasUv);
          if (vAtlasSet > 1.5 && vAtlasSet < 2.5) sprite = texture2D(atlas2, vAtlasUv);
          if (vAtlasSet > 2.5 && vAtlasSet < 3.5) sprite = texture2D(atlas3, vAtlasUv);
          if (vAtlasSet > 3.5) sprite = texture2D(atlas4, vAtlasUv);
          if (vCrowdTension > 0.5) {
            sprite = texture2D(tensionAtlas, vTensionUv);
          }
          if (sprite.a < 0.18) discard;
          gl_FragColor = vec4(sprite.rgb * vTint, sprite.a);
        }
      `,
      // These are alpha-cutout cards, not blended transparent planes. Visible
      // pixels must write depth so nearer spectators correctly occlude rows
      // behind them even though every tier is rendered as one instanced draw.
      transparent: false,
      depthWrite: true,
      depthTest: true,
      alphaToCoverage: true,
      side: THREE.FrontSide,
    });
    return this.crowdMaterial;
  }

  private crowdNoise(value: number): number {
    const hashed = Math.sin(value * 12.9898) * 43758.5453;
    return hashed - Math.floor(hashed);
  }

  /**
   * Crowd energy from -1 (held breath) through 0 (normal match) to +1 (roar).
   * Eased toward the requested value so the stands never snap between moods.
   */
  public setCrowdMood(mood: number): void {
    this.targetCrowdMood = THREE.MathUtils.clamp(mood, -1, 1);
  }

  /** Capture-only reaction: tense, clenched hands rather than idle or cheering. */
  public setCrowdTension(active: boolean): void {
    this.crowdTension = active;
  }

  public update(time: number, cameraPosition: THREE.Vector3, dt: number = 0.016): void {
    this.backdrop.update(time);
    this.crowdMood = THREE.MathUtils.damp(this.crowdMood, this.targetCrowdMood, 5, dt);
    if (this.crowdMaterial) {
      this.crowdMaterial.uniforms.time.value = time;
      this.crowdMaterial.uniforms.mood.value = this.crowdMood;
    }
    // A hush leaves almost everyone seated; a roar puts the whole stand up.
    const cheerThreshold = 0.42 - this.crowdMood * 0.95;
    this.crowdBatches.forEach(({ atlasCell, tension, mesh, members }) => {
      const dummy = new THREE.Object3D();
      members.forEach((member, index) => {
        const viewAngle = Math.atan2(cameraPosition.x - member.position.x, cameraPosition.z - member.position.z);
        const relative = this.wrapAngle(viewAngle - member.facing);
        // Camera-angle sign is opposite the character's local left/right in
        // this pitch-facing coordinate system, so select the opposite side
        // column rather than making spectators turn away from the match.
        const direction = Math.abs(relative) > Math.PI * 0.75 ? 2 : relative > Math.PI * 0.25 ? 3 : relative < -Math.PI * 0.25 ? 1 : 0;
        const cheering = Math.sin(time * 2.2 + member.phase) > cheerThreshold ? 1 : 0;
        // Tension sprites occupy the idle row for each character pair in their
        // parallel atlas, so their direction selection stays identical.
        const rowFromTop = Math.floor(member.character / 2) * 2 + (this.crowdTension ? 0 : cheering);
        atlasCell.setXY(index, (member.character % 2) * 4 + direction, 3 - rowFromTop);
        tension.setX(index, this.crowdTension ? 1 : 0);

        // One-sided card: yaw it towards the viewer, then select the art that
        // matches the viewer's angle around the fixed pitch-facing spectator.
        dummy.position.copy(member.position);
        dummy.lookAt(cameraPosition.x, member.position.y, cameraPosition.z);
        dummy.scale.setScalar(member.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      atlasCell.needsUpdate = true;
      tension.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private wrapAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  private buildJumbotron(): void {
    // Single screen on the far side, facing the default camera.
    const frameGeo = new THREE.BoxGeometry(36, 18, 1.5);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111b24 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 16, -38);

    const screenGeo = new THREE.PlaneGeometry(33, 15);
    const screenMat = new THREE.MeshBasicMaterial({
      map: this.jumbotronFeedTarget.texture,
    });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.z = 0.8;
    frame.add(screen);

    this.environmentGroup.add(frame);
    this.jumbotronFrame = frame;

    this.updateJumbotron(this.map.name.toUpperCase(), this.map.venue, 1);
  }

  /** Render the live stadium camera into the jumbotron before the main frame. */
  public updateJumbotronFeed(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.jumbotronFrame) return;

    const previousTarget = renderer.getRenderTarget();
    const previousAspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : null;
    this.jumbotronFrame.visible = false;
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = this.jumbotronFeedTarget.width / this.jumbotronFeedTarget.height;
      camera.updateProjectionMatrix();
    }

    try {
      renderer.setRenderTarget(this.jumbotronFeedTarget);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      this.jumbotronFrame.visible = true;
      if (camera instanceof THREE.PerspectiveCamera && previousAspect !== null) {
        camera.aspect = previousAspect;
        camera.updateProjectionMatrix();
      }
    }
  }

  public updateJumbotron(title: string, subtitle: string, wave: number): void {
    const signature = `${title}\u0000${subtitle}\u0000${wave}`;
    if (signature === this.jumbotronSignature) return;
    this.jumbotronSignature = signature;
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

  public isBuildable(x: number, z: number, radius: number): BuildBlockReason {
    return mapBuildBlock(this.map,this.routes,x,z,radius,this.terrain);
  }

  public getNoBuildZones(): readonly NoBuildZone[] {
    return this.map.obstacles;
  }

  public setNoBuildZones(zones: NoBuildZone[]): void {
    this.map.obstacles = zones;
    disposeScenery(this.noBuildGroup);
    this.noBuildGroup.clear();
    zones.forEach(zone => this.noBuildGroup.add(buildMapObstacle(zone,this.map,this.terrain)));
  }

  /** Clears grass and other incidental dressing beneath placed tower pads. */
  public clearGroundPropsBelow(footprints: readonly { centre: THREE.Vector3; radius: number }[]): void {
    const signature = footprints.map(({ centre, radius }) => `${centre.x.toFixed(3)},${centre.z.toFixed(3)},${radius.toFixed(3)}`).sort().join('|');
    if (signature === this.groundPropMask) return;
    this.groundPropMask = signature;
    maskGroundProps(this.environmentGroup, footprints.map(({ centre, radius }) => ({ x: centre.x, z: centre.z, radius })));
  }

  public dispose(): void {
    disposeScenery(this.group);
    this.jumbotronTexture.dispose();
    this.jumbotronFeedTarget.dispose();
  }
}
