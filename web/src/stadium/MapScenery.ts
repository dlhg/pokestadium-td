import * as THREE from 'three';
import type { MapObstacle, StadiumMap } from '../td/MapCatalog';

function material(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function mesh(parent: THREE.Group, geometry: THREE.BufferGeometry, mat: THREE.Material, x=0, y=0, z=0): THREE.Mesh {
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

/** Original, deterministic N64-style set dressing. No downloaded art is used. */
export function buildMapGround(map: StadiumMap): THREE.Group {
  const group = new THREE.Group();
  group.name = `terrain-${map.theme}`;
  mesh(group,new THREE.CylinderGeometry(35,35,1.4,64),material(map.palette.edge),0,-0.75,0);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = map.palette.ground;
  ctx.fillRect(0,0,1024,1024);
  let seed = 917;
  const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed/4294967296; };
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

  for (const region of map.water) {
    const shape = new THREE.Shape(region.points.map(([x,z])=>new THREE.Vector2(x,-z)));
    const bank = mesh(group,new THREE.ShapeGeometry(shape),material('#345c66'),0,0.025,0);
    bank.rotation.x=-Math.PI/2;
    const water = mesh(group,new THREE.ShapeGeometry(shape),new THREE.MeshPhongMaterial({color:'#318eb0',specular:'#b1eeff',shininess:70}),0,0.045,0);
    water.rotation.x=-Math.PI/2;
    water.castShadow=false;
    const shore = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(region.points.map(([x,z])=>new THREE.Vector3(x,0.08,z))),new THREE.LineBasicMaterial({color:'#bcebd4'}));
    group.add(shore);
    for (let z=-18;z<21;z+=3.7) {
      const ripple=mesh(group,new THREE.PlaneGeometry(1.3,0.08),new THREE.MeshBasicMaterial({color:'#a0dfe0'}),Math.sin(z)*1.5,0.08,z);
      ripple.rotation.x=-Math.PI/2; ripple.castShadow=false;
    }
  }
  for (const bridge of map.bridges) {
    const wood = material('#b78e60'), darkWood=material('#624a35');
    const deck = new THREE.Group(); deck.position.set(bridge.x,0,bridge.z); group.add(deck);
    for (let x=-bridge.width/2+0.3;x<bridge.width/2;x+=0.65) {
      mesh(deck,new THREE.BoxGeometry(0.6,0.16,bridge.depth),wood,x,0.42,0);
    }
    for (const side of [-1,1]) {
      mesh(deck,new THREE.BoxGeometry(bridge.width,0.16,0.16),darkWood,0,1,side*bridge.depth/2);
      for (const x of [-bridge.width/2,0,bridge.width/2]) {
        mesh(deck,new THREE.CylinderGeometry(0.14,0.19,1.25,6),darkWood,x,0.65,side*bridge.depth/2);
      }
    }
  }
  return group;
}

export function buildMapObstacle(zone: MapObstacle, map: StadiumMap): THREE.Group {
  const prop=new THREE.Group();
  prop.position.set(zone.x,0,zone.z);
  prop.name=`obstacle-${zone.style}-${zone.label}`;
  const r=zone.radius;
  // The visible base fills exactly the blocked circle, including small gaps between props.
  disc(prop,r,map.theme==='industrial' ? '#253746' : map.palette.edge,0.06);
  if (zone.style==='tree') {
    disc(prop,r*0.95,'#385e3c',0.08);
    for (let i=0;i<3;i++) {
      const angle=i*Math.PI*2/3;
      const x=Math.cos(angle)*r*0.38, z=Math.sin(angle)*r*0.38;
      mesh(prop,new THREE.CylinderGeometry(0.18,0.3,r*0.85,6),material('#755335'),x,r*0.43,z);
      const canopy=mesh(prop,new THREE.IcosahedronGeometry(r*0.53,1),material(['#83af64','#568c55','#679e58'][i]),x,r*(0.91+i*0.08),z);
      canopy.scale.y=1.2;
      for (let f=0;f<3;f++) {
        const a=angle+f*0.4;
        mesh(prop,new THREE.IcosahedronGeometry(0.13,0),material('#f3d683'),Math.cos(a)*r*0.83,0.2,Math.sin(a)*r*0.83);
      }
    }
  } else if (zone.style==='rock') {
    for (let i=0;i<4;i++) {
      const angle=i*Math.PI/2+0.3;
      const rock=mesh(prop,new THREE.DodecahedronGeometry(r*(0.38+i*0.035)),material(['#b29b8c','#927b73','#c0a996','#827074'][i]),Math.cos(angle)*r*0.36,r*0.36,Math.sin(angle)*r*0.36);
      rock.scale.y=i===2?1.7:1.05;
      rock.rotation.y=i*1.3;
    }
    if (map.theme==='canyon') {
      const crystal=mesh(prop,new THREE.ConeGeometry(r*0.15,r*0.72,5),material('#ccabdf'),-r*0.5,r*0.5,r*0.35);
      crystal.rotation.z=-0.2;
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
