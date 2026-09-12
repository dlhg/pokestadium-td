import * as THREE from 'three';
import type { MapPoint, StadiumMap } from './MapCatalog';

/** One sampled centreline drives the preview, rendered lane, movement and collision. */
export function sampleMapRoutes(map: StadiumMap): THREE.Vector3[][] {
  return map.routes.map(points => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x,z]) => new THREE.Vector3(x,0.5,z)), false, 'centripetal');
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

export type MapBuildBlock = 'out_of_bounds' | 'on_lane' | 'restricted' | 'water' | null;
export function mapBuildBlock(map: StadiumMap, routes: THREE.Vector3[][], x: number, z: number, radius: number): MapBuildBlock {
  if (Math.hypot(x,z) > map.buildableRadius-radius) return 'out_of_bounds';
  for (const route of routes) {
    for (let i=1; i<route.length; i++) {
      const a=route[i-1], b=route[i];
      if (segmentDistance(x,z,a.x,a.z,b.x,b.z) < map.laneWidth/2+radius) return 'on_lane';
    }
  }
  if (map.water.some(region => touchesPolygon(x,z,radius,region.points))) return 'water';
  if (map.obstacles.some(zone => Math.hypot(x-zone.x,z-zone.z) < zone.radius+radius)) return 'restricted';
  return null;
}
