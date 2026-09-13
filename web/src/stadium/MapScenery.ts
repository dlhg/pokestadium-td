import * as THREE from 'three';
import type { MapDecor, MapObstacle, StadiumMap } from '../td/MapCatalog';
import { LANE_RIDE_HEIGHT, type MapTerrain } from '../td/MapTerrain';
import { segmentDistance, touchesPolygon } from '../td/MapGeometry';

function material(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, x=0, y=0, z=0): THREE.Mesh {
  const result = new THREE.Mesh(geometry, mat);
  result.position.set(x,y,z);
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

function disc(parent: THREE.Group, radius: number, color: THREE.ColorRepresentation, y: number): THREE.Mesh {
  const result = mesh(parent, new THREE.CircleGeometry(radius,48), material(color),0,y,0);
  result.rotation.x = -Math.PI/2;
  result.castShadow = false;
  return result;
}

/** Small deterministic generator: the same course always dresses the same way. */
function seeded(seed: number): () => number {
  let state = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  return () => { state = (Math.imul(state,1664525)+1013904223) >>> 0; return state/4294967296; };
}
function hash2(x: number, z: number): number {
  const s = Math.sin(x*127.1 + z*311.7) * 43758.5453;
  return s - Math.floor(s);
}
/** Cheap value noise for broad colour patches on terrain. */
function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x-ix, fz = z-iz;
  const sx = fx*fx*(3-2*fx), sz = fz*fz*(3-2*fz);
  const a = hash2(ix,iz), b = hash2(ix+1,iz), c = hash2(ix,iz+1), d = hash2(ix+1,iz+1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a,b,sx), THREE.MathUtils.lerp(c,d,sx), sz);
}

/** Original, deterministic N64-style set dressing. No downloaded art is used. */
export function buildMapGround(map: StadiumMap, terrain: MapTerrain, routes: THREE.Vector3[][]): THREE.Group {
  const group = new THREE.Group();
  group.name = `terrain-${map.theme}`;
  mesh(group,new THREE.CylinderGeometry(35,35,1.4,64),material(map.palette.edge),0,-0.75,0);

  if (terrain.flat) buildFlatFloor(group, map);
  else {
    group.add(buildTerrainMesh(map, terrain));
    buildBoundary(group, map, terrain);
    scatterGrass(group, map, terrain, routes);
    routes.forEach(route => buildStairs(group, map, route));
  }

  for (const region of map.water) {
    const surface = region.height ?? 0;
    const shape = new THREE.Shape(region.points.map(([x,z])=>new THREE.Vector2(x,-z)));
    const bank = mesh(group,new THREE.ShapeGeometry(shape),material('#345c66'),0,surface+0.025,0);
    bank.rotation.x=-Math.PI/2;
    const water = mesh(group,new THREE.ShapeGeometry(shape),new THREE.MeshPhongMaterial({color:'#318eb0',specular:'#b1eeff',shininess:70}),0,surface+0.045,0);
    water.rotation.x=-Math.PI/2;
    water.castShadow=false;
    const shore = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(region.points.map(([x,z])=>new THREE.Vector3(x,surface+0.08,z))),new THREE.LineBasicMaterial({color:'#bcebd4'}));
    group.add(shore);
    const zs = region.points.map(p=>p[1]), xs = region.points.map(p=>p[0]);
    for (let z=Math.min(...zs)+1.5;z<Math.max(...zs)-1;z+=3.7) {
      for (let x=Math.min(...xs)+1;x<Math.max(...xs);x+=4) {
        const rx = x+Math.sin(z)*1.2;
        const inside = (px: number) => touchesPolygon(px,z,0,region.points);
        if (!inside(rx) || !inside(rx-0.8) || !inside(rx+0.8)) continue;
        const ripple=mesh(group,new THREE.PlaneGeometry(1.3,0.08),new THREE.MeshBasicMaterial({color:'#a0dfe0'}),rx,surface+0.08,z);
        ripple.rotation.x=-Math.PI/2; ripple.castShadow=false;
      }
    }
  }
  for (const bridge of map.bridges) {
    const wood = material('#b78e60'), darkWood=material('#624a35');
    const deck = new THREE.Group(); deck.position.set(bridge.x,terrain.heightAt(bridge.x,bridge.z),bridge.z); group.add(deck);
    const halfWidth = bridge.width/2;
    const archY = (x: number) => bridge.rise ? bridge.rise*(1-(x/halfWidth)**2) : 0;
    for (let x=-halfWidth+0.3;x<halfWidth;x+=0.65) {
      mesh(deck,new THREE.BoxGeometry(0.6,0.16,bridge.depth),wood,x,0.42+archY(x),0);
    }
    for (const side of [-1,1]) {
      const zSide = side*bridge.depth/2;
      if (bridge.rise) {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(-halfWidth,1,zSide),
          new THREE.Vector3(0,1+bridge.rise,zSide),
          new THREE.Vector3(halfWidth,1,zSide),
        );
        mesh(deck,new THREE.TubeGeometry(curve,16,0.08,6,false),darkWood);
      } else {
        mesh(deck,new THREE.BoxGeometry(bridge.width,0.16,0.16),darkWood,0,1,zSide);
      }
      for (const x of [-halfWidth,0,halfWidth]) {
        mesh(deck,new THREE.CylinderGeometry(0.14,0.19,1.25,6),darkWood,x,0.65+archY(x),zSide);
      }
    }
  }
  for (const item of map.decor ?? []) group.add(buildDecor(item, map, terrain));
  return group;
}

function buildFlatFloor(group: THREE.Group, map: StadiumMap): void {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = map.palette.ground;
  ctx.fillRect(0,0,1024,1024);
  const random = seeded(917);
  // Quiet texture under the route: visible terrain, readable silhouettes.
  for (let i=0;i<850;i++) {
    const x=random()*1024, y=random()*1024, size=3+random()*28;
    ctx.fillStyle = i%3 ? map.palette.patch : map.palette.edge;
    ctx.globalAlpha = i%3 ? 0.28 : 0.09;
    ctx.beginPath();
    ctx.ellipse(x,y,size,size*0.48,random()*Math.PI,0,Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha=1;
  if (map.theme === 'industrial') {
    ctx.strokeStyle='#70848e';
    ctx.lineWidth=1;
    for (let n=0;n<=1024;n+=64) {
      ctx.beginPath(); ctx.moveTo(n,0); ctx.lineTo(n,1024); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,n); ctx.lineTo(1024,n); ctx.stroke();
    }
  }
  // The broadcast arena boundary is also the actual build limit.
  ctx.strokeStyle=map.palette.accent;
  ctx.lineWidth=3;
  ctx.setLineDash([12,10]);
  ctx.beginPath();ctx.arc(512,512,map.buildableRadius/35*512,0,Math.PI*2);ctx.stroke();
  ctx.setLineDash([]);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.magFilter=THREE.NearestFilter;
  const floor = mesh(group,new THREE.CircleGeometry(35,64),new THREE.MeshLambertMaterial({map:texture}),0,0,0);
  floor.rotation.x=-Math.PI/2;
  floor.castShadow=false;
}

/**
 * Faceted heightfield. Terrace tops read as meadow, cliff faces as banded earth
 * like the ledges of Route 2 and Mt. Silver. Cliff vertices are nudged sideways
 * only, so the rock looks broken without changing any buildable height.
 */
function buildTerrainMesh(map: StadiumMap, terrain: MapTerrain): THREE.Mesh {
  const step = 0.5, extent = 35.5;
  const ground = new THREE.Color(map.palette.ground), patch = new THREE.Color(map.palette.patch);
  const cliff = new THREE.Color(map.palette.edge), cliffDark = cliff.clone().multiplyScalar(0.72);
  const lip = cliff.clone().lerp(ground, 0.45);
  const sunlit = new THREE.Color('#c9d88a');
  const positions: number[] = [], colors: number[] = [];

  const vertex = (x: number, z: number): THREE.Vector3 => {
    const y = terrain.heightAt(x,z);
    const gx = terrain.heightAt(x+0.35,z) - terrain.heightAt(x-0.35,z);
    const gz = terrain.heightAt(x,z+0.35) - terrain.heightAt(x,z-0.35);
    const steep = THREE.MathUtils.clamp(Math.hypot(gx,gz) - 0.3, 0, 1);
    return new THREE.Vector3(
      x + (hash2(x,z)-0.5)*0.2*steep,
      y,
      z + (hash2(z+7.3,x)-0.5)*0.2*steep,
    );
  };
  const color = new THREE.Color();
  const pushTriangle = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => {
    const cx = (p0.x+p1.x+p2.x)/3, cz = (p0.z+p1.z+p2.z)/3, cy = (p0.y+p1.y+p2.y)/3;
    // Classify by the ground's true gradient, not the jittered facet, so bands stay clean.
    const gradient = Math.hypot(terrain.heightAt(cx+0.3,cz)-terrain.heightAt(cx-0.3,cz), terrain.heightAt(cx,cz+0.3)-terrain.heightAt(cx,cz-0.3)) / 0.6;
    if (gradient > 1.1) {
      // Earth strata: alternating bands, darker toward each terrace's foot.
      const band = Math.floor(cy / 0.55 + hash2(Math.round(cx),Math.round(cz))*0.35);
      color.copy(band % 2 ? cliff : cliffDark);
    } else if (gradient > 0.4) {
      color.copy(lip);
    } else {
      const n = valueNoise(cx*0.18, cz*0.18);
      color.copy(ground).lerp(patch, THREE.MathUtils.smoothstep(n,0.35,0.75));
      color.lerp(sunlit, (cy / Math.max(1, terrain.maxHeight)) * 0.18);
    }
    color.offsetHSL(0, 0, (hash2(cx*3.1,cz*2.7)-0.5)*0.035);
    for (const p of [p0,p1,p2]) { positions.push(p.x,p.y,p.z); colors.push(color.r,color.g,color.b); }
  };

  for (let x = -extent; x < extent; x += step) {
    for (let z = -extent; z < extent; z += step) {
      if (Math.hypot(x+step/2, z+step/2) > 35.6) continue;
      const p00 = vertex(x,z), p10 = vertex(x+step,z), p01 = vertex(x,z+step), p11 = vertex(x+step,z+step);
      // Alternate the diagonal so faceting doesn't form visible stripes.
      if ((Math.round(x/step) + Math.round(z/step)) % 2) {
        pushTriangle(p00,p01,p10); pushTriangle(p10,p01,p11);
      } else {
        pushTriangle(p00,p01,p11); pushTriangle(p00,p11,p10);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  const result = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  result.name = 'terrain-heightfield';
  result.receiveShadow = true;
  result.castShadow = true;
  return result;
}

/** The dashed build limit follows the ground instead of floating over cliffs. */
function buildBoundary(group: THREE.Group, map: StadiumMap, terrain: MapTerrain): void {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 360; i++) {
    const a = i / 360 * Math.PI * 2, x = Math.cos(a)*map.buildableRadius, z = Math.sin(a)*map.buildableRadius;
    points.push(new THREE.Vector3(x, terrain.heightAt(x,z)+0.08, z));
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: map.palette.accent, dashSize: 0.8, gapSize: 0.65 }));
  line.computeLineDistances();
  group.add(line);
}

/** Grass tufts on open meadow keep large terraces from reading as flat colour. */
function scatterGrass(group: THREE.Group, map: StadiumMap, terrain: MapTerrain, routes: THREE.Vector3[][]): void {
  const random = seeded(map.id.length * 7919 + 17);
  const tuft = new THREE.ConeGeometry(0.12, 0.42, 4);
  tuft.translate(0, 0.21, 0);
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(map.palette.patch).offsetHSL(0,0.05,-0.08), flatShading: true });
  const tufts = new THREE.InstancedMesh(tuft, mat, 900);
  const dummy = new THREE.Object3D();
  let count = 0;
  for (let attempt = 0; attempt < 5000 && count < 900; attempt++) {
    const x = (random()*2-1)*33, z = (random()*2-1)*33;
    if (Math.hypot(x,z) > 33.5 || valueNoise(x*0.25,z*0.25) < 0.45) continue;
    const { low, high } = terrain.footprint(x,z,0.4);
    if (high - low > 0.2) continue;
    if (map.water.some(w => touchesPolygon(x,z,0.4,w.points))) continue;
    if (routes.some(route => route.some((p,i) => i > 0 && segmentDistance(x,z,route[i-1].x,route[i-1].z,p.x,p.z) < map.laneWidth/2 + 0.5))) continue;
    if (map.obstacles.some(o => Math.hypot(x-o.x,z-o.z) < o.radius)) continue;
    for (let blade = 0; blade < 3 && count < 900; blade++) {
      const bx = x + (random()-0.5)*0.35, bz = z + (random()-0.5)*0.35;
      dummy.position.set(bx, terrain.heightAt(bx,bz), bz);
      dummy.rotation.set((random()-0.5)*0.5, random()*Math.PI, (random()-0.5)*0.5);
      dummy.scale.setScalar(0.7 + random()*0.7);
      dummy.updateMatrix();
      tufts.setMatrixAt(count++, dummy.matrix);
    }
  }
  tufts.count = count;
  tufts.receiveShadow = true;
  group.add(tufts);
}

/** Stone steps and curbs wherever a lane climbs, like the Indigo Plateau approach. */
function buildStairs(group: THREE.Group, map: StadiumMap, route: THREE.Vector3[]): void {
  const stone = [material('#ddd5c1'), material('#c3b9a2')], curb = material('#8e8574');
  const half = map.laneWidth/2;
  for (let i = 1; i < route.length-1; i++) {
    const before = route[i-1], after = route[i+1];
    const run = Math.hypot(after.x-before.x, after.z-before.z);
    if (Math.abs(after.y-before.y) / run < 0.08) continue;
    const point = route[i];
    // Adjacent treads share their cross-section exactly, including on curves.
    // Rotated boxes leave gaps on the outside of a bend and overlap inside it.
    const start = before.clone().lerp(point, 0.5), end = point.clone().lerp(after, 0.5);
    const startDir = point.clone().sub(before).setY(0).normalize();
    const endDir = after.clone().sub(point).setY(0).normalize();
    const startNormal = new THREE.Vector3(-startDir.z, 0, startDir.x);
    const endNormal = new THREE.Vector3(-endDir.z, 0, endDir.x);
    // Clear the sloping ribbon even at the uphill end of the tread.
    const top = Math.max(start.y, point.y, end.y) - LANE_RIDE_HEIGHT + 0.2;
    const bottom = Math.min(start.y, point.y, end.y) - LANE_RIDE_HEIGHT - 0.3;
    const tread = (left: number, right: number, height: number, mat: THREE.Material) => {
      const corners = [start.clone().addScaledVector(startNormal,left), start.clone().addScaledVector(startNormal,right),
        end.clone().addScaledVector(endNormal,right), end.clone().addScaledVector(endNormal,left)];
      const positions = [bottom, height].flatMap(y => corners.flatMap(p => [p.x,y,p.z]));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
      geometry.setIndex([4,5,6,4,6,7, 0,2,1,0,3,2, 0,5,4,0,1,5,
        1,6,5,1,2,6, 2,7,6,2,3,7, 3,4,7,3,0,4]);
      geometry.computeVertexNormals();
      mesh(group, geometry, mat);
    };
    tread(-half-0.05, half+0.05, top, stone[i%2]);
    tread(-half-0.45, -half-0.05, top+0.2, curb);
    tread(half+0.05, half+0.45, top+0.2, curb);
  }
}

function buildDecor(item: MapDecor, map: StadiumMap, terrain: MapTerrain): THREE.Group {
  const root = new THREE.Group();
  root.name = `decor-${item.kind}`;
  root.position.set(item.x, terrain.heightAt(item.x,item.z), item.z);
  const random = seeded(hash2(item.x,item.z)*1e6);
  if (item.kind === 'waterfall') {
    root.position.y = item.top;
    root.rotation.y = item.angle;
    const run = item.drop / 2.2 + 0.25;
    const geometry = new THREE.PlaneGeometry(item.width, 1, 1, 8);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = 0.5 - pos.getY(i); // 0 at the lip, 1 at the pool
      pos.setXYZ(i, pos.getX(i), 0.06 - t*item.drop, run*Math.sqrt(t) + 0.05);
    }
    geometry.computeVertexNormals();
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#4fb6d6'; ctx.fillRect(0,0,32,64);
    for (let n = 0; n < 26; n++) {
      ctx.fillStyle = n%3 ? '#bdf1ff' : '#ffffff';
      ctx.fillRect(Math.floor(random()*32), Math.floor(random()*64), 1+Math.floor(random()*2), 6+Math.floor(random()*14));
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(item.width/1.6, 1);
    texture.magFilter = THREE.NearestFilter;
    const fall = mesh(root, geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
    fall.castShadow = false;
    fall.onBeforeRender = () => { texture.offset.y = (performance.now() * 0.0011) % 1; };
    const foam = material('#f2fdff');
    for (let n = 0; n < 7; n++) {
      const puff = mesh(root, new THREE.IcosahedronGeometry(0.28+random()*0.25, 0), foam, (n/6-0.5)*item.width, -item.drop+0.15, run+0.25+random()*0.4);
      puff.castShadow = false;
      const phase = random()*6;
      puff.onBeforeRender = () => { puff.scale.setScalar(0.8 + Math.sin(performance.now()*0.006 + phase)*0.25); };
    }
  } else if (item.kind === 'torch') {
    mesh(root, new THREE.CylinderGeometry(0.16,0.24,1.2,6), material('#6f6a61'), 0, 0.6, 0);
    mesh(root, new THREE.CylinderGeometry(0.42,0.22,0.35,8), material('#3f3b37'), 0, 1.35, 0);
    const outer = mesh(root, new THREE.ConeGeometry(0.3,0.8,6), new THREE.MeshBasicMaterial({ color:'#ff7a1a' }), 0, 1.85, 0);
    const inner = mesh(root, new THREE.ConeGeometry(0.16,0.5,5), new THREE.MeshBasicMaterial({ color:'#ffe27a' }), 0, 1.75, 0);
    outer.castShadow = inner.castShadow = false;
    const phase = random()*6;
    outer.onBeforeRender = () => {
      const t = performance.now()*0.012 + phase;
      outer.scale.set(1, 0.85 + Math.sin(t)*0.12 + Math.sin(t*2.3)*0.06, 1);
      inner.scale.set(1, 0.9 + Math.sin(t*1.7)*0.14, 1);
    };
  } else if (item.kind === 'cave') {
    // Victory Road's mouth: a rock mound with a dark arch facing the trail.
    root.rotation.y = item.angle;
    const shades = ['#7d6a5d','#6b5a50','#8c7866','#5e4f47'];
    for (let n = 0; n < 7; n++) {
      const a = Math.PI*0.55 + (n/6)*Math.PI*0.9;
      const r = 1.9 + random()*0.8;
      const rock = mesh(root, new THREE.DodecahedronGeometry(1.3+random()*0.9, 0), material(shades[n%4]), Math.cos(a)*r*1.2, 0.9+random()*0.8, -Math.abs(Math.sin(a))*r*0.7 - 0.6);
      rock.rotation.set(random()*3, random()*3, random()*3);
      rock.scale.y = 1.1 + random()*0.5;
    }
    mesh(root, new THREE.DodecahedronGeometry(2.4, 0), material('#6b5a50'), 0, 2.6, -1.6).scale.set(1.3,0.8,1);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(1.8, 12, 0, Math.PI), new THREE.MeshBasicMaterial({ color:'#120c0a' }));
    mouth.position.set(0, 0.05, 0.25);
    mouth.scale.set(1, 1.25, 1);
    root.add(mouth);
  } else if (item.kind === 'flowers') {
    const petals = ['#f49ac2','#fff4f0','#ffd35c','#f9738c'].map(material);
    const leaf = material('#4f8a3f');
    for (let n = 0; n < Math.round(item.radius*9); n++) {
      const a = random()*Math.PI*2, r = Math.sqrt(random())*item.radius;
      const x = Math.cos(a)*r, z = Math.sin(a)*r;
      const y = terrain.heightAt(item.x+x, item.z+z) - root.position.y;
      mesh(root, new THREE.IcosahedronGeometry(0.1+random()*0.05, 0), leaf, x, y+0.08, z).castShadow = false;
      mesh(root, new THREE.IcosahedronGeometry(0.11, 0), petals[n%4], x+0.05, y+0.24, z).castShadow = false;
    }
  } else if (item.kind === 'arch') {
    root.rotation.y = item.angle;
    const beam = map.theme === 'plateau' && item.text.startsWith('INDIGO') ? '#c7932e' : '#7b4d34';
    mesh(root, new THREE.BoxGeometry(item.span+1.2, 0.45, 0.6), material(beam), 0, 3.9, 0);
    mesh(root, new THREE.BoxGeometry(item.span+1.6, 0.18, 0.8), material('#e9dcc0'), 0, 4.2, 0);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#14304a'; ctx.fillRect(0,0,512,96);
    ctx.strokeStyle = map.palette.accent; ctx.lineWidth = 6; ctx.strokeRect(4,4,504,88);
    ctx.fillStyle = map.palette.accent; ctx.font = 'bold 54px Impact, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(item.text, 256, 70);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(item.span*0.8, item.span*0.15), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    sign.position.set(0, 4.75, 0);
    // Tipped back toward the tactical camera so it reads from above.
    sign.rotation.x = -0.75;
    root.add(sign);
  }
  return root;
}

export function buildMapObstacle(zone: MapObstacle, map: StadiumMap, terrain: MapTerrain): THREE.Group {
  const prop=new THREE.Group();
  prop.position.set(zone.x,terrain.heightAt(zone.x,zone.z),zone.z);
  prop.name=`obstacle-${zone.style}-${zone.label}`;
  const r=zone.radius;
  // Every prop is dressed from its own position, so neighbours never repeat.
  const random=seeded(hash2(zone.x,zone.z)*1e6+r*97);
  const base = map.theme==='industrial' ? '#253746'
    : zone.style==='pillar' || zone.style==='brick' ? '#cfc6b0'
    : zone.style==='tree' || zone.style==='pine' ? '#3f6a3e' : map.palette.edge;
  // The visible base fills exactly the blocked circle, including small gaps between props.
  disc(prop,r,base,0.06);
  if (zone.style==='tree') {
    disc(prop,r*0.95,'#385e3c',0.08);
    const trunks=2+Math.floor(random()*3);
    const leaves=['#83af64','#568c55','#679e58','#8fbf5a','#4e7d4a'];
    for (let i=0;i<trunks;i++) {
      const angle=i*Math.PI*2/trunks+random()*0.8;
      const spread=r*(0.25+random()*0.2);
      const x=Math.cos(angle)*spread, z=Math.sin(angle)*spread;
      const height=r*(0.7+random()*0.45);
      mesh(prop,new THREE.CylinderGeometry(0.16,0.3,height,6),material('#755335'),x,height/2,z);
      const canopy=mesh(prop,new THREE.IcosahedronGeometry(r*(0.42+random()*0.18),1),material(leaves[Math.floor(random()*leaves.length)]),x,height+r*0.25,z);
      canopy.scale.set(1+random()*0.2,1.05+random()*0.3,1+random()*0.2);
      canopy.rotation.y=random()*3;
    }
    for (let f=0;f<5;f++) {
      const a=random()*Math.PI*2;
      mesh(prop,new THREE.IcosahedronGeometry(0.13,0),material(random()<0.5?'#f3d683':'#f2a6c4'),Math.cos(a)*r*0.83,0.2,Math.sin(a)*r*0.83);
    }
  } else if (zone.style==='pine') {
    disc(prop,r*0.92,'#2f5534',0.08);
    const trees=2+Math.floor(random()*3);
    for (let i=0;i<trees;i++) {
      const angle=random()*Math.PI*2, spread=i===0?0:r*(0.35+random()*0.3);
      const x=Math.cos(angle)*spread, z=Math.sin(angle)*spread;
      const height=r*(1.2+random()*0.9)*(i===0?1.15:0.85);
      const width=r*(0.42+random()*0.12);
      mesh(prop,new THREE.CylinderGeometry(0.12,0.2,height*0.35,5),material('#5e4330'),x,height*0.17,z);
      const greens=['#2f6b45','#3b7a4c','#26573a'];
      for (let tier=0;tier<3;tier++) {
        const cone=mesh(prop,new THREE.ConeGeometry(width*(1-tier*0.27),height*0.42,7),material(greens[(tier+i)%3]),x,height*(0.36+tier*0.22),z);
        cone.rotation.y=random()*3;
      }
    }
  } else if (zone.style==='boulder') {
    // Strength boulder: one round, cracked stone that obviously could be pushed.
    const stone=mesh(prop,new THREE.IcosahedronGeometry(r*0.78,1),material(random()<0.5?'#a39585':'#968a80'),0,r*0.68,0);
    stone.scale.set(1,0.88,1);
    stone.rotation.set(random()*3,random()*3,random()*3);
    const crack=material('#5b524b');
    for (let i=0;i<2;i++) {
      const line=mesh(prop,new THREE.BoxGeometry(0.06,r*0.9,0.06),crack,(random()-0.5)*r*0.5,r*0.75,r*0.74);
      line.rotation.z=(random()-0.5)*1.2;
    }
    for (let i=0;i<3;i++) {
      const a=random()*Math.PI*2;
      mesh(prop,new THREE.DodecahedronGeometry(0.15+random()*0.18,0),material('#8a7d72'),Math.cos(a)*r*0.9,0.12,Math.sin(a)*r*0.9);
    }
  } else if (zone.style==='pillar') {
    // Indigo Plateau gatepost: stone plinth, gold banding, lantern cap.
    mesh(prop,new THREE.BoxGeometry(r*1.5,0.5,r*1.5),material('#d9d1bd'),0,0.25,0);
    mesh(prop,new THREE.BoxGeometry(r*1.05,3.4,r*1.05),material('#8a5f2c'),0,2.1,0);
    for (const y of [1.1,2.3,3.5]) mesh(prop,new THREE.BoxGeometry(r*1.15,0.16,r*1.15),material('#f2c65a'),0,y,0);
    mesh(prop,new THREE.BoxGeometry(r*1.4,0.3,r*1.4),material('#d9d1bd'),0,3.95,0);
    mesh(prop,new THREE.OctahedronGeometry(r*0.4,0),new THREE.MeshBasicMaterial({color:'#a7e3ff'}),0,4.45,0);
  } else if (zone.style==='brick') {
    // Route 23 badge-check post: coursed brick with a pale stone cap.
    const courses=['#9b5a3c','#874b33'];
    for (let i=0;i<9;i++) mesh(prop,new THREE.BoxGeometry(r*1.3+(i%2)*0.06,0.38,r*1.3+(i%2)*0.06),material(courses[i%2]),0,0.19+i*0.38,0);
    mesh(prop,new THREE.BoxGeometry(r*1.6,0.28,r*1.6),material('#e2d3b5'),0,3.55,0);
  } else if (zone.style==='center') {
    // Pokémon Center: the last heal before the League, as on Route 23 and Mt. Silver.
    const body=new THREE.Group(); body.rotation.y=Math.PI*0.08; prop.add(body);
    const w=r*1.35, d=r*1.05;
    mesh(body,new THREE.BoxGeometry(w+0.3,0.25,d+0.3),material('#d6ccb6'),0,0.12,0);
    mesh(body,new THREE.BoxGeometry(w,1.7,d),material('#f3efe6'),0,1.1,0);
    mesh(body,new THREE.BoxGeometry(w+0.35,0.5,d+0.35),material('#d9453b'),0,2.15,0);
    mesh(body,new THREE.BoxGeometry(w*0.7,0.35,d*0.7),material('#c23a31'),0,2.55,0);
    mesh(body,new THREE.BoxGeometry(w*0.34,1.1,0.12),material('#76c5e6'),0,0.8,d/2+0.02);
    mesh(body,new THREE.BoxGeometry(w*0.9,0.28,0.1),material('#d9453b'),0,1.72,d/2+0.03);
    const ball=mesh(body,new THREE.CylinderGeometry(0.42,0.42,0.1,16),material('#ffffff'),0,2.2,d/2+0.2);
    ball.rotation.x=Math.PI/2;
    const top=mesh(body,new THREE.CylinderGeometry(0.43,0.43,0.11,16,1,false,0,Math.PI),material('#e0463c'),0,2.2,d/2+0.21);
    top.rotation.set(Math.PI/2,Math.PI/2,0);
  } else if (zone.style==='rock') {
    const count=3+Math.floor(random()*4);
    const shades=['#b29b8c','#927b73','#c0a996','#827074','#a48f7d'];
    for (let i=0;i<count;i++) {
      const angle=i*Math.PI*2/count+random()*0.9;
      const spread=r*(0.2+random()*0.4);
      const size=r*(0.25+random()*0.2)*(i===0?1.35:1);
      const rock=mesh(prop,new THREE.DodecahedronGeometry(size),material(shades[Math.floor(random()*shades.length)]),Math.cos(angle)*spread,size*0.8,Math.sin(angle)*spread);
      rock.scale.set(1+random()*0.3,0.8+random()*(i===0?1.1:0.5),1+random()*0.3);
      rock.rotation.set(random()*0.6,random()*6,random()*0.6);
    }
    if (map.theme==='canyon') {
      for (let c=Math.floor(random()*3);c>0;c--) {
        const a=random()*Math.PI*2;
        const crystal=mesh(prop,new THREE.ConeGeometry(r*(0.1+random()*0.08),r*(0.5+random()*0.4),5),material(random()<0.6?'#ccabdf':'#9fd4e8'),Math.cos(a)*r*0.55,r*0.4,Math.sin(a)*r*0.55);
        crystal.rotation.set((random()-0.5)*0.8,0,(random()-0.5)*0.8);
      }
    }
  } else {
    for (let i=0;i<16;i++) {
      const a=i*Math.PI/8;
      const stripe=mesh(prop,new THREE.BoxGeometry(r*0.27,0.035,0.45),material(i%2?'#263340':'#e6bc57'),Math.cos(a)*r*0.86,0.1,Math.sin(a)*r*0.86);
      stripe.rotation.y=-a;
    }
    mesh(prop,new THREE.CylinderGeometry(r*0.63,r*0.73,0.7,8),material('#7c919b'),0,0.4);
    mesh(prop,new THREE.CylinderGeometry(r*0.39,r*0.48,2.6,10),material('#364c62'),0,1.9);
    for (const y of [1,1.65,2.3,2.95]) {
      const coil=mesh(prop,new THREE.TorusGeometry(r*0.42,0.13,5,12),new THREE.MeshBasicMaterial({color:'#75dceb'}),0,y);
      coil.rotation.x=Math.PI/2;
    }
    mesh(prop,new THREE.CylinderGeometry(r*0.52,r*0.38,0.5,8),material('#c3c8b1'),0,3.25);
    mesh(prop,new THREE.SphereGeometry(0.28,8,5),new THREE.MeshBasicMaterial({color:'#ffd568'}),0,3.7);
  }
  return prop;
}

/** Dispose owned environment resources when changing courses. */
export function disposeScenery(group: THREE.Group): void {
  const geometries=new Set<THREE.BufferGeometry>(), materials=new Set<THREE.Material>(), textures=new Set<THREE.Texture>();
  group.traverse(object=>{
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite)) return;
    if (!(object instanceof THREE.Sprite)) geometries.add(object.geometry);
    for (const mat of Array.isArray(object.material)?object.material:[object.material]) {
      materials.add(mat);
      if ('map' in mat && mat.map instanceof THREE.Texture) textures.add(mat.map);
    }
  });
  geometries.forEach(geo=>geo.dispose());materials.forEach(mat=>mat.dispose());textures.forEach(tex=>tex.dispose());
}
