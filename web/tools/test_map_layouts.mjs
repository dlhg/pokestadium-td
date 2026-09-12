import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle TypeScript in memory; no test dependencies or generated files needed.
const result = await build({
  stdin: {
    contents: "export * from './src/td/MapCatalog.ts'; export * from './src/td/MapGeometry.ts';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { STADIUM_MAPS, sampleMapRoutes, mapBuildBlock, segmentDistance, touchesPolygon } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

const signatures = new Set();
for (const map of STADIUM_MAPS) {
  const routes = sampleMapRoutes(map);
  signatures.add(JSON.stringify(map.routes));
  for (const [index, route] of routes.entries()) {
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
    assert.equal(mapBuildBlock(map,routes,obstacle.x,obstacle.z,0),'restricted');
    for (const route of routes) for (let i=1; i<route.length; i++) {
      const a=route[i-1], b=route[i];
      const clearance=segmentDistance(obstacle.x,obstacle.z,a.x,a.z,b.x,b.z)-obstacle.radius-map.laneWidth/2;
      assert.ok(clearance >= 0, `${map.id}: ${obstacle.label} overlaps the lane`);
    }
  }
  let buildSites=0;
  for(let x=-30;x<=30;x+=2) for(let z=-30;z<=30;z+=2) {
    if(mapBuildBlock(map,routes,x,z,1.6)===null) buildSites++;
  }
  assert.ok(buildSites>100,`${map.id}: insufficient usable terrain`);
  assert.equal(mapBuildBlock(map,routes,32,0,1.6),'out_of_bounds');
  if(map.water.length) {
    assert.equal(mapBuildBlock(map,routes,0,0,1.6),'water');
    // Every actual river crossing must have a visible bridge deck beneath it.
    for(const route of routes) for(const p of route) {
      if(!map.water.some(w=>touchesPolygon(p.x,p.z,0,w.points))) continue;
      assert.ok(map.bridges.some(b=>Math.abs(p.x-b.x)<=b.width/2 && Math.abs(p.z-b.z)<=b.depth/2),`${map.id}: unbridged river crossing`);
    }
  }
  console.log(`${map.name}: ${routes.length} route(s), ${buildSites} legal sample sites, lane / obstacle / water checks passed`);
}
assert.equal(signatures.size, STADIUM_MAPS.length, 'Maps share an identical route');
assert.equal(STADIUM_MAPS.find(m=>m.id==='power-plant').routes.length,2);

// Edge clearance matters even when the tower centre is outside the water.
const square=[[-2,-2],[2,-2],[2,2],[-2,2]];
assert.equal(touchesPolygon(3,0,1.6,square),true);
assert.equal(touchesPolygon(4,0,1.6,square),false);
console.log('All map layout checks passed.');
