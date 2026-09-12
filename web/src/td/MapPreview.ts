import type { StadiumMap } from './MapCatalog';
import { sampleMapRoutes } from './MapGeometry';

/** A top-down drawing of the actual playable course, including every route. */
export function mapPreview(map: StadiumMap): string {
  const routes=sampleMapRoutes(map);
  const paths=routes.map(route=>route.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(' '));
  const obstacles=map.obstacles.map(zone=>{
    const color=zone.style==='tree'?'#365e3d':zone.style==='rock'?'#776770':'#253a50';
    const inner=zone.style==='tree'?'#8bbb6e':zone.style==='rock'?'#b5a092':'#73d9e6';
    return `<circle cx="${zone.x}" cy="${zone.z}" r="${zone.radius}" fill="${color}"/><circle cx="${zone.x-0.3}" cy="${zone.z-0.5}" r="${zone.radius*0.65}" fill="${inner}"/>`;
  }).join('');
  const gates=routes.map(route=>[route[0],route[route.length-1]].map((p,i)=>`<circle cx="${p.x}" cy="${p.z}" r="1.65" fill="${i?'#fa8e76':'#96f3b1'}" stroke="#183348" stroke-width=".45"/>`).join('')).join('');
  return `<svg class="map-preview" viewBox="-36 -30 72 60" aria-hidden="true">
    <rect x="-36" y="-30" width="72" height="60" fill="${map.palette.ground}"/>
    <circle r="${map.buildableRadius}" fill="${map.palette.patch}" stroke="${map.palette.accent}" stroke-width=".25" stroke-dasharray="1 1"/>
    ${map.water.map(w=>`<polygon points="${w.points.map(p=>p.join(',')).join(' ')}" fill="#369fb9" stroke="#b4e1d3" stroke-width=".4"/>`).join('')}
    ${paths.map(d=>`<path d="${d}" fill="none" stroke="${map.palette.edge}" stroke-width="${map.laneWidth+0.7}" stroke-linejoin="round"/>`).join('')}
    ${paths.map(d=>`<path d="${d}" fill="none" stroke="${map.palette.path}" stroke-width="${map.laneWidth}" stroke-linejoin="round"/>`).join('')}
    ${map.bridges.map(b=>`<rect x="${b.x-b.width/2}" y="${b.z-b.depth/2}" width="${b.width}" height="${b.depth}" fill="#b98f62" stroke="#624b37" stroke-width=".4"/>`).join('')}
    ${obstacles}${gates}
  </svg>`;
}
