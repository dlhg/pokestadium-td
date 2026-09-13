import * as THREE from 'three';
import type { MapPoint, StadiumMap } from './MapCatalog';
import { LANE_RIDE_HEIGHT, landformHeight, type MapTerrain } from './MapTerrain';

/** One sampled centreline drives the preview, rendered lane, movement and collision. */
export function sampleMapRoutes(map: StadiumMap): THREE.Vector3[][] {
  return map.routes.map(points => {
    const controls = points.map(([x,z,y]) => new THREE.Vector3(x,(y ?? landformHeight(map,x,z)) + LANE_RIDE_HEIGHT,z));
    const curve = new THREE.CatmullRomCurve3(controls, false, 'centripetal');
    curve.arcLengthDivisions = 1200;
    return curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.45));
  });
}

export function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx-ax, dz = bz-az;
  const t = Math.max(0, Math.min(1, ((x-ax)*dx + (z-az)*dz) / (dx*dx + dz*dz || 1)));
  return Math.hypot(x-ax-t*dx, z-az-t*dz);
}

/** The entire tower footprint must clear a river bank, not just its centre. */
export function touchesPolygon(x: number, z: number, radius: number, points: MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length-1; i < points.length; j = i++) {
    const [ax,az] = points[i], [bx,bz] = points[j];
    if (segmentDistance(x,z,ax,az,bx,bz) < radius) return true;
    if ((az > z) !== (bz > z) && x < (bx-ax)*(z-az)/(bz-az)+ax) inside = !inside;
  }
  return inside;
}

/** Tallest step a tower pad can bridge. Gentle slopes build; cliff faces do not. */
export const MAX_FOOTPRINT_RELIEF = 0.75;

export type MapBuildBlock = 'out_of_bounds' | 'on_lane' | 'restricted' | 'water' | 'too_steep' | null;
export function mapBuildBlock(map: StadiumMap, routes: THREE.Vector3[][], x: number, z: number, radius: number, terrain?: MapTerrain): MapBuildBlock {
  if (Math.hypot(x,z) > map.buildableRadius-radius) return 'out_of_bounds';
  for (const route of routes) {
    for (let i=1; i<route.length; i++) {
      const a=route[i-1], b=route[i];
      if (segmentDistance(x,z,a.x,a.z,b.x,b.z) < map.laneWidth/2+radius) return 'on_lane';
    }
  }
  if (map.water.some(region => touchesPolygon(x,z,radius,region.points))) return 'water';
  if (map.obstacles.some(zone => Math.hypot(x-zone.x,z-zone.z) < zone.radius+radius)) return 'restricted';
  if (terrain && !terrain.flat) {
    const { low, high } = terrain.footprint(x,z,radius);
    if (high - low > MAX_FOOTPRINT_RELIEF) return 'too_steep';
  }
  return null;
}

/** Taper the inside of tight bends so the swept road cannot fold over itself. */
export function buildLaneRibbon(points: THREE.Vector3[], halfWidth: number, lift: number): THREE.BufferGeometry {
  const normals = points.map((_, i) => {
    const before = points[Math.max(0, i-1)], after = points[Math.min(points.length-1, i+1)];
    return new THREE.Vector3(before.z-after.z, 0, after.x-before.x).normalize();
  });
  const limits = points.map(() => [Infinity, Infinity]);
  for (let i=1; i<points.length-1; i++) {
    const incoming = points[i].clone().sub(points[i-1]).setY(0);
    const outgoing = points[i+1].clone().sub(points[i]).setY(0);
    const angle = incoming.angleTo(outgoing);
    if (angle < 1e-6) continue;
    const radius = Math.min(incoming.length(), outgoing.length()) / (2*Math.tan(angle/2));
    const side = incoming.x*outgoing.z-incoming.z*outgoing.x > 0 ? 0 : 1;
    // Ease into the bend instead of abruptly pinching a single cross-section.
    for (const step of [-1, 1]) {
      let distance = 0;
      for (let j=i; j>=0 && j<points.length; j+=step) {
        if (j!==i) distance += points[j].distanceTo(points[j-step]);
        if (distance > halfWidth*2) break;
        limits[j][side] = Math.min(limits[j][side], radius*0.65 + distance*0.25);
      }
    }
  }
  const positions: number[] = [], indices: number[] = [];
  points.forEach((point, i) => {
    for (const side of [0, 1]) {
      const width = Math.min(halfWidth, limits[i][side]) * (side===0 ? 1 : -1);
      positions.push(point.x+normals[i].x*width, point.y-LANE_RIDE_HEIGHT+lift, point.z+normals[i].z*width);
    }
    if (i<points.length-1) {
      const v=i*2;
      indices.push(v,v+1,v+2,v+1,v+3,v+2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
