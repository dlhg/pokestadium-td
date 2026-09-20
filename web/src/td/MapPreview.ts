import type { ObstacleStyle, StadiumMap } from './MapCatalog';
import { sampleMapRoutes } from './MapGeometry';

const PREVIEW_COLORS: Record<ObstacleStyle,[string,string]> = {
  tree:['#365e3d','#8bbb6e'], pine:['#24462f','#4f8b5c'], rock:['#776770','#b5a092'], boulder:['#6f665e','#a99d91'],
  generator:['#253a50','#73d9e6'], pillar:['#8a5f2c','#f2c65a'], brick:['#6e3f2b','#b0674a'], center:['#f3efe6','#d9453b'],
  'ancient-tree':['#345d38','#78a85b'], 'rest-nook':['#6a5639','#d4a75f'], 'garden-pond':['#467c72','#66bed0'],
  'flower-emblem':['#f0e4ba','#d94b52'], 'bug-habitat':['#4a6336','#9a6d42'],
};

/** Higher terraces are lighter, with a dark cliff line, so elevation reads at card size. */
function terraces(map: StadiumMap): string {
  if (!map.terrain) return '';
  const top = Math.max(...map.terrain.plateaus.map(p=>p.height));
  const shapes = [...map.terrain.plateaus].sort((a,b)=>a.height-b.height).map(p=>{
    const shade = Math.round(p.height/top*22);
    return `<polygon points="${p.points.map(q=>q.join(',')).join(' ')}" fill="${map.palette.patch}" style="filter:brightness(${100+shade}%)" stroke="${map.palette.edge}" stroke-width=".9"/>`;
  }).join('');
  return `<clipPath id="rim-${map.id}"><circle r="34"/></clipPath><g clip-path="url(#rim-${map.id})">${shapes}</g>`;
}

/** A top-down drawing of the actual playable course, including every route. */
export function mapPreview(map: StadiumMap): string {
  const routes=sampleMapRoutes(map);
  const paths=routes.map(route=>route.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(' '));
  const obstacles=map.obstacles.map(zone=>{
    const [color,inner]=PREVIEW_COLORS[zone.style];
    return `<circle cx="${zone.x}" cy="${zone.z}" r="${zone.radius}" fill="${color}"/><circle cx="${zone.x-0.3}" cy="${zone.z-0.5}" r="${zone.radius*0.65}" fill="${inner}"/>`;
  }).join('');
  const gates=routes.map(route=>[route[0],route[route.length-1]].map((p,i)=>`<circle cx="${p.x}" cy="${p.z}" r="1.65" fill="${i?'#fa8e76':'#96f3b1'}" stroke="#183348" stroke-width=".45"/>`).join('')).join('');
  return `<svg class="map-preview" viewBox="-36 -30 72 60" aria-hidden="true">
    <rect x="-36" y="-30" width="72" height="60" fill="${map.palette.ground}"/>
    <circle r="${map.buildableRadius}" fill="${map.palette.patch}" stroke="${map.palette.accent}" stroke-width=".25" stroke-dasharray="1 1"/>
    ${terraces(map)}
    ${map.water.map(w=>`<polygon points="${w.points.map(p=>p.join(',')).join(' ')}" fill="#369fb9" stroke="#b4e1d3" stroke-width=".4"/>`).join('')}
    ${paths.map(d=>`<path d="${d}" fill="none" stroke="${map.palette.edge}" stroke-width="${map.laneWidth+0.7}" stroke-linejoin="round"/>`).join('')}
    ${paths.map(d=>`<path d="${d}" fill="none" stroke="${map.palette.path}" stroke-width="${map.laneWidth}" stroke-linejoin="round"/>`).join('')}
    ${map.bridges.map(b=>`<rect x="${b.x-b.width/2}" y="${b.z-b.depth/2}" width="${b.width}" height="${b.depth}" fill="#b98f62" stroke="#624b37" stroke-width=".4"/>`).join('')}
    ${obstacles}${gates}
  </svg>`;
}
