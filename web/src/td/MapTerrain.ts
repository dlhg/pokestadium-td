import * as THREE from 'three';
import type { MapPoint, StadiumMap } from './MapCatalog';

/** Vertical rise per unit of horizontal run on a cliff face. */
export const CLIFF_GRADE = 2.2;
/** Creep and lane centrelines ride this far above the ground they cross. */
export const LANE_RIDE_HEIGHT = 0.5;
/** Arena floor: the diorama rim falls back to zero before the perimeter wall. */
const RIM_RADIUS = 34.2;
const RIM_GRADE = 3.2;
const EXTENT = 36;
const CELL = 0.5;
const SIZE = Math.round(EXTENT * 2 / CELL) + 1;
/** Beyond the lane edge the cutting blends back into the natural slope over this run. */
const CUT_SHOULDER = 0.7, CUT_BLEND = 2.6;

function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx-ax, dz = bz-az;
  const t = Math.max(0, Math.min(1, ((x-ax)*dx + (z-az)*dz) / (dx*dx + dz*dz || 1)));
  return Math.hypot(x-ax-t*dx, z-az-t*dz);
}

/** 0 inside the outline, otherwise the distance to its nearest edge. */
function outsideDistance(x: number, z: number, points: MapPoint[]): number {
  let inside = false, nearest = Infinity;
  for (let i = 0, j = points.length-1; i < points.length; j = i++) {
    const [ax,az] = points[i], [bx,bz] = points[j];
    nearest = Math.min(nearest, segmentDistance(x,z,ax,az,bx,bz));
    if ((az > z) !== (bz > z) && x < (bx-ax)*(z-az)/(bz-az)+ax) inside = !inside;
  }
  return inside ? 0 : nearest;
}

/** The natural landform — terraces and cliffs — before any lane is cut into it. */
export function landformHeight(map: StadiumMap, x: number, z: number): number {
  if (!map.terrain) return 0;
  let height = 0;
  for (const plateau of map.terrain.plateaus) {
    height = Math.max(height, plateau.height - outsideDistance(x,z,plateau.points) * CLIFF_GRADE);
  }
  return Math.min(height, Math.max(0, RIM_RADIUS - Math.hypot(x,z)) * RIM_GRADE);
}

/**
 * Baked ground height for a course. Movement, placement, picking and rendering
 * all read this one grid, so what the player sees is exactly what the rules use.
 */
export class MapTerrain {
  public readonly flat: boolean;
  public readonly maxHeight: number;
  private heights: Float32Array;

  constructor(map: StadiumMap, routes: THREE.Vector3[][]) {
    this.flat = !map.terrain;
    this.heights = new Float32Array(SIZE * SIZE);
    if (this.flat) { this.maxHeight = 0; return; }

    const cutWeight = new Float32Array(SIZE * SIZE);
    const cutHeight = new Float32Array(SIZE * SIZE);
    const cutDistance = new Float32Array(SIZE * SIZE).fill(Infinity);
    const half = map.laneWidth / 2, reach = half + CUT_SHOULDER + CUT_BLEND;
    for (const route of routes) for (const point of route) {
      const laneGround = point.y - LANE_RIDE_HEIGHT;
      const [c0, r0] = this.cellOf(point.x - reach, point.z - reach);
      const [c1, r1] = this.cellOf(point.x + reach, point.z + reach);
      for (let r = Math.max(0, r0); r <= Math.min(SIZE-1, r1+1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(SIZE-1, c1+1); c++) {
          const d = Math.hypot(c*CELL - EXTENT - point.x, r*CELL - EXTENT - point.z);
          const t = THREE.MathUtils.clamp((d - half - CUT_SHOULDER) / CUT_BLEND, 0, 1);
          const w = 1 - t*t*(3 - 2*t);
          const i = r*SIZE + c;
          // On a stair every nearby sample is at full weight; the closest one knows the step height.
          if (w > cutWeight[i] + 1e-6 || (w > cutWeight[i] - 1e-6 && d < cutDistance[i])) {
            cutWeight[i] = Math.max(w, cutWeight[i]); cutHeight[i] = laneGround; cutDistance[i] = d;
          }
        }
      }
    }
    let max = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const i = r*SIZE + c;
      const natural = landformHeight(map, c*CELL - EXTENT, r*CELL - EXTENT);
      this.heights[i] = THREE.MathUtils.lerp(natural, cutHeight[i], cutWeight[i]);
      max = Math.max(max, this.heights[i]);
    }
    this.maxHeight = max;
  }

  private cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x + EXTENT) / CELL), Math.floor((z + EXTENT) / CELL)];
  }

  public heightAt(x: number, z: number): number {
    if (this.flat) return 0;
    const fx = THREE.MathUtils.clamp((x + EXTENT) / CELL, 0, SIZE-1.001);
    const fz = THREE.MathUtils.clamp((z + EXTENT) / CELL, 0, SIZE-1.001);
    const c = Math.floor(fx), r = Math.floor(fz), u = fx-c, v = fz-r;
    const h = this.heights;
    const top = h[r*SIZE+c]*(1-u) + h[r*SIZE+c+1]*u;
    const bottom = h[(r+1)*SIZE+c]*(1-u) + h[(r+1)*SIZE+c+1]*u;
    return top*(1-v) + bottom*v;
  }

  /** Samples the centre, an inner ring and the rim of a round footprint. */
  public footprint(x: number, z: number, radius: number): { low: number; high: number } {
    let low = this.heightAt(x,z), high = low;
    for (const scale of [0.5, 1]) for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + scale;
      const h = this.heightAt(x + Math.cos(a)*radius*scale, z + Math.sin(a)*radius*scale);
      low = Math.min(low, h); high = Math.max(high, h);
    }
    return { low, high };
  }

  /** First point where the ray meets the ground, marched then refined. */
  public raycast(ray: THREE.Ray): THREE.Vector3 | null {
    const { origin, direction } = ray;
    if (direction.y >= -1e-4) return null;
    if (this.flat) return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0), 0), new THREE.Vector3());
    const at = (t: number) => origin.y + direction.y*t - this.heightAt(origin.x + direction.x*t, origin.z + direction.z*t);
    let t0 = Math.max(0, (origin.y - this.maxHeight - 0.1) / -direction.y);
    const tEnd = origin.y / -direction.y + 0.01;
    const step = 0.2;
    for (let t = t0 + step; t <= tEnd + step; t += step) {
      if (at(t) <= 0) {
        let lo = t0, hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (at(mid) > 0) lo = mid; else hi = mid;
        }
        return ray.at(hi, new THREE.Vector3());
      }
      t0 = t;
    }
    return null;
  }
}
