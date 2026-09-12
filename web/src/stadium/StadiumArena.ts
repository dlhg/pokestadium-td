/**
 * StadiumArena.ts — 3D Pokémon Stadium Colosseum Environment
 *
 * Renders authored tower-defense courses inside the Pokémon Stadium arena:
 * - Themed terrain, water, bridges and low-poly placement obstacles
 * - Map-specific lanes sharing geometry with navigation and placement tests
 * - Free-placement build rules: arena bounds, lane clearance, keep-out zones
 * - Stadium grandstands, animated spectator crowd, and perimeter walls
 * - Floodlight towers and giant stadium jumbotrons
 */

import * as THREE from 'three';
import { DEFAULT_STADIUM_MAP, type MapObstacle, type StadiumMap } from '../td/MapCatalog';
import { mapBuildBlock, sampleMapRoutes, type MapBuildBlock } from '../td/MapGeometry';
import { buildMapGround, buildMapObstacle, disposeScenery } from './MapScenery';

export type BuildBlockReason = MapBuildBlock;
export type NoBuildZone = MapObstacle;

export class StadiumArena {
  public group: THREE.Group = new THREE.Group();
  public waypoints: THREE.Vector3[] = [];
  public routes: THREE.Vector3[][] = [];

  /** Towers may be placed anywhere inside this radius of the pitch centre. */
  public readonly buildableRadius: number;
  public readonly map: StadiumMap;
  private environmentGroup = new THREE.Group();
  private gameplayGroup = new THREE.Group();
  private noBuildGroup = new THREE.Group();

  // Jumbotron dynamic canvas textures
  private jumbotronCanvas: HTMLCanvasElement;
  private jumbotronCtx: CanvasRenderingContext2D;
  private jumbotronTexture: THREE.CanvasTexture;

  constructor(map: StadiumMap = DEFAULT_STADIUM_MAP) {
    this.map = map;
    this.buildableRadius = map.buildableRadius;
    this.routes = sampleMapRoutes(map);
    this.waypoints = this.routes[0];
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
    this.setNoBuildZones(map.obstacles);
  }

  private initArena(): void {
    this.environmentGroup.add(new THREE.HemisphereLight(0xe6f1ff, 0x647557, 1.1));
    this.environmentGroup.add(buildMapGround(this.map));
    this.buildTrackPath();
    this.buildGrandstands();
    this.buildFloodlightTowers();
    this.buildJumbotrons();

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
      // Constant-width ribbon with shared normals at joins; all routes use
      // exactly the same sampled points as movement and placement collision.
      for (const edge of [true,false]) {
        const halfWidth=this.map.laneWidth/2+(edge?0.22:0);
        const positions:number[]=[], indices:number[]=[];
        points.forEach((point,index)=>{
          const before=points[Math.max(0,index-1)], after=points[Math.min(points.length-1,index+1)];
          const direction=new THREE.Vector3().subVectors(after,before).normalize();
          const normal=new THREE.Vector3(-direction.z,0,direction.x).multiplyScalar(halfWidth);
          positions.push(point.x+normal.x,edge?0.12:0.14,point.z+normal.z,point.x-normal.x,edge?0.12:0.14,point.z-normal.z);
          if(index<points.length-1) {
            const v=index*2; indices.push(v,v+1,v+2,v+1,v+3,v+2);
          }
        });
        const geometry=new THREE.BufferGeometry();
        geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
        geometry.setIndex(indices);geometry.computeVertexNormals();
        const track=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({color:edge?this.map.palette.edge:this.map.palette.path,side:THREE.DoubleSide}));
        track.receiveShadow=true;track.name=`route-${routeIndex}-${edge?'edge':'lane'}`;
        this.gameplayGroup.add(track);
      }
      // Direction chevrons make the winding and crossing routes legible.
      for(let i=8;i<points.length-8;i+=28) {
        const point=points[i], next=points[i+2];
        const shape=new THREE.Shape();
        shape.moveTo(-0.65,0.38);shape.lineTo(0, -0.38);shape.lineTo(0.65,0.38);
        shape.lineTo(0.65,0.05);shape.lineTo(0,-0.7);shape.lineTo(-0.65,0.05);shape.closePath();
        const arrow=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color:this.map.theme==='industrial'?(routeIndex?'#66cee5':'#f9d578'):this.map.palette.edge,side:THREE.DoubleSide}));
        arrow.rotation.x=-Math.PI/2;
        arrow.rotation.z=Math.atan2(next.x-point.x,next.z-point.z);
        arrow.position.set(point.x,0.55,point.z);
        this.gameplayGroup.add(arrow);
      }
      this.addGate(points[0],points[1],true,routeIndex);
      this.addGate(points[points.length-1],points[points.length-2],false,routeIndex);
    });
  }

  private addGate(point: THREE.Vector3, adjacent: THREE.Vector3, entry: boolean, index: number): void {
    const gate=new THREE.Group();
    gate.position.set(point.x,0,point.z);
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
    ctx.fillText(`${entry?'IN':'OUT'}${this.routes.length>1?' '+(index+1):''}`,128,46);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:texture}));
    sign.scale.set(4.3,1.1,1);sign.position.y=3;gate.add(sign);
    this.gameplayGroup.add(gate);
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

    this.updateJumbotron(this.map.name.toUpperCase(), this.map.venue, 1);
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

  public isBuildable(x: number, z: number, radius: number): BuildBlockReason {
    return mapBuildBlock(this.map,this.routes,x,z,radius);
  }

  public getNoBuildZones(): readonly NoBuildZone[] {
    return this.map.obstacles;
  }

  public setNoBuildZones(zones: NoBuildZone[]): void {
    this.map.obstacles = zones;
    disposeScenery(this.noBuildGroup);
    this.noBuildGroup.clear();
    zones.forEach(zone => this.noBuildGroup.add(buildMapObstacle(zone,this.map)));
  }

  public dispose(): void {
    disposeScenery(this.group);
    this.jumbotronTexture.dispose();
  }
}
