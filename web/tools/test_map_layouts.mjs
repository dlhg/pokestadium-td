import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle TypeScript in memory; no test dependencies or generated files needed.
const result = await build({
  stdin: {
    contents: "export * from './src/td/MapCatalog.ts'; export * from './src/td/MapGeometry.ts'; export * from './src/td/MapTerrain.ts';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { STADIUM_MAPS, sampleMapRoutes, buildLaneRibbon, mapBuildBlock, segmentDistance, touchesPolygon, MapTerrain, LANE_RIDE_HEIGHT } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

const signatures = new Set();
for (const map of STADIUM_MAPS) {
  const routes = sampleMapRoutes(map);
  const terrain = new MapTerrain(map, routes);
  signatures.add(JSON.stringify(map.routes));
  for (const [index, route] of routes.entries()) {
    // A tight inside corner must not reverse triangle winding and overlap itself.
    for (const halfWidth of [map.laneWidth/2, map.laneWidth/2+0.22]) {
      const ribbon = buildLaneRibbon(route, halfWidth, 0.14);
      const positions = ribbon.getAttribute('position'), indices = ribbon.getIndex();
      for (let i=0; i<indices.count; i+=3) {
        const [a,b,c] = [indices.getX(i),indices.getX(i+1),indices.getX(i+2)];
        const signedArea = (positions.getX(b)-positions.getX(a))*(positions.getZ(c)-positions.getZ(a))
          - (positions.getZ(b)-positions.getZ(a))*(positions.getX(c)-positions.getX(a));
        assert.ok(signedArea > 1e-6, `${map.id}: folded lane triangle on route ${index}, triangle ${i/3}`);
      }
      ribbon.dispose();
    }
    const first = map.routes[index][0], last = map.routes[index].at(-1);
    assert.ok(Math.hypot(route[0].x-first[0], route[0].z-first[1]) < 0.001);
    assert.ok(Math.hypot(route.at(-1).x-last[0], route.at(-1).z-last[1]) < 0.001);
    for (let i=1; i<route.length; i++) {
      assert.ok(route[i].distanceTo(route[i-1]) < 0.46, `${map.id}: route discontinuity`);
      const x=(route[i].x+route[i-1].x)/2, z=(route[i].z+route[i-1].z)/2;
      if (Math.hypot(x,z) < map.buildableRadius-1.6) {
        assert.equal(mapBuildBlock(map,routes,x,z,1.6),'on_lane',`${map.id}: lane accepts a tower`);
      }
    }
  }
  for (const obstacle of map.obstacles) {
    assert.equal(mapBuildBlock(map,routes,obstacle.x,obstacle.z,0),'restricted',`${map.id}: ${obstacle.label} center is on a lane`);
    for (const route of routes) for (let i=1; i<route.length; i++) {
      const a=route[i-1], b=route[i];
      const clearance=segmentDistance(obstacle.x,obstacle.z,a.x,a.z,b.x,b.z)-obstacle.radius-map.laneWidth/2;
      assert.ok(clearance >= 0, `${map.id}: ${obstacle.label} overlaps the lane`);
    }
  }
  let buildSites=0;
  for(let x=-30;x<=30;x+=2) for(let z=-30;z<=30;z+=2) {
    if(mapBuildBlock(map,routes,x,z,1.6,terrain)===null) buildSites++;
  }
  assert.ok(buildSites>100,`${map.id}: insufficient usable terrain (${buildSites} legal sample sites)`);
  assert.equal(mapBuildBlock(map,routes,32,0,1.6),'out_of_bounds');
  if(map.id==='cerulean-crossing') assert.equal(mapBuildBlock(map,routes,0,0,1.6),'water');
  if(map.water.length) {
    // Every actual river crossing must have a visible bridge deck beneath it.
    for(const route of routes) for(const p of route) {
      if(!map.water.some(w=>touchesPolygon(p.x,p.z,0,w.points))) continue;
      assert.ok(map.bridges.some(b=>Math.abs(p.x-b.x)<=b.width/2 && Math.abs(p.z-b.z)<=b.depth/2),`${map.id}: unbridged river crossing`);
    }
  }
  if(map.terrain) {
    for(const route of routes) for(let i=1;i<route.length;i++) {
      const p=route[i];
      // The lane is cut into the hillside: creeps never float or sink.
      assert.ok(Math.abs(terrain.heightAt(p.x,p.z)-(p.y-LANE_RIDE_HEIGHT))<0.12,`${map.id}: lane leaves the ground at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      const run=Math.hypot(p.x-route[i-1].x,p.z-route[i-1].z);
      assert.ok(Math.abs(p.y-route[i-1].y)/run<0.6,`${map.id}: stair too steep at ${p.x.toFixed(1)},${p.z.toFixed(1)} (${(Math.abs(p.y-route[i-1].y)/run).toFixed(2)})`);
    }
    for(const obstacle of map.obstacles) {
      const {low,high}=terrain.footprint(obstacle.x,obstacle.z,obstacle.radius*0.8);
      assert.ok(high-low<0.6,`${map.id}: ${obstacle.label} straddles a cliff`);
    }
    // Every terrace must offer real build sites, or it is only scenery.
    for(const plateau of map.terrain.plateaus) {
      let sites=0;
      for(let x=-30;x<=30;x+=1) for(let z=-30;z<=30;z+=1) {
        if(Math.abs(terrain.heightAt(x,z)-plateau.height)<0.05 && touchesPolygon(x,z,0,plateau.points)
          && mapBuildBlock(map,routes,x,z,1.6,terrain)===null) sites++;
      }
      assert.ok(sites>=6,`${map.id}: ${plateau.label} has only ${sites} build sites`);
      console.log(`  ${plateau.label} (${plateau.height}): ${sites} build sites`);
    }
    let cliffSite = false;
    for(let x=-28;x<=28 && !cliffSite;x+=1) for(let z=-28;z<=28;z+=1) {
      if(mapBuildBlock(map,routes,x,z,1.6,terrain)==='too_steep') { cliffSite=true; break; }
    }
    assert.ok(cliffSite,`${map.id}: no unbuildable cliff face found`);
    // Picking from the tactical camera lands on the terrace the player sees, not the plane below it.
    const THREE = await import('three');
    for (const [x,z] of [[-6,-25],[24,-2],[-14,17],[6,-12]]) {
      const target = new THREE.Vector3(x, terrain.heightAt(x,z), z), eye = new THREE.Vector3(4,82,42);
      const hit = terrain.raycast(new THREE.Ray(eye, target.clone().sub(eye).normalize()));
      assert.ok(hit && hit.distanceTo(target) < 0.15, `${map.id}: ground pick missed ${x},${z}`);
    }
  }
  console.log(`${map.name}: ${routes.length} route(s), ${buildSites} legal sample sites, lane / obstacle / water checks passed`);
}
assert.equal(signatures.size, STADIUM_MAPS.length, 'Maps share an identical route');
assert.equal(STADIUM_MAPS.find(m=>m.id==='power-plant').routes.length,2);
const silverRoutes=sampleMapRoutes(STADIUM_MAPS.find(m=>m.id==='mt-silver-crown'));
assert.equal(silverRoutes.length,2);
assert.ok(silverRoutes[1].length>silverRoutes[0].length*1.2,'Mt. Silver routes are not meaningfully asymmetric');

// Edge clearance matters even when the tower centre is outside the water.
const square=[[-2,-2],[2,-2],[2,2],[-2,2]];
assert.equal(touchesPolygon(3,0,1.6,square),true);
assert.equal(touchesPolygon(4,0,1.6,square),false);
console.log('All map layout checks passed.');
