/** Authored courses: routes, terrain and collision all share these definitions. */
export type MapDifficulty = 'easy' | 'medium' | 'hard';
export type MapPoint = readonly [x: number, z: number];
/** A route control point. Height defaults to the terrace beneath it; give one to pin a stair landing. */
export type RoutePoint = readonly [x: number, z: number, y?: number];
export type ObstacleStyle = 'rock' | 'tree' | 'generator' | 'pine' | 'boulder' | 'pillar' | 'brick' | 'center';

export interface MapObstacle {
  x: number; z: number; radius: number; label: string; style: ObstacleStyle;
}
/** Water surface sits at `height` (default 0), so springs can pool on a terrace. */
export interface WaterRegion { points: MapPoint[]; height?: number; }
/** `rise` optionally bows the deck into a gentle arc, peaking at its midpoint. */
export interface MapBridge { x: number; z: number; width: number; depth: number; rise?: number; }

/** A flat-topped terrace. Outside its outline the ground falls away as a cliff. */
export interface MapPlateau { points: MapPoint[]; height: number; label: string; }
export interface MapTerrainSpec {
  plateaus: MapPlateau[];
}

/** Set dressing that tells the course's story without changing the rules. */
export type MapDecor =
  | { kind: 'waterfall'; x: number; z: number; angle: number; width: number; top: number; drop: number; }
  | { kind: 'torch'; x: number; z: number; }
  | { kind: 'cave'; x: number; z: number; angle: number; }
  | { kind: 'flowers'; x: number; z: number; radius: number; }
  | { kind: 'arch'; x: number; z: number; angle: number; span: number; text: string; };

export interface StadiumMap {
  id: string;
  name: string;
  venue: string;
  difficulty: MapDifficulty;
  description: string;
  strategy: string;
  theme: 'garden' | 'canyon' | 'river' | 'industrial' | 'plateau';
  palette: { ground: string; patch: string; path: string; edge: string; accent: string };
  buildableRadius: number;
  laneWidth: number;
  routes: RoutePoint[][];
  obstacles: MapObstacle[];
  water: WaterRegion[];
  bridges: MapBridge[];
  /** Omitted on flat courses. */
  terrain?: MapTerrainSpec;
  decor?: MapDecor[];
}

// Victory Road → Indigo Plateau tiers. Outlines run past the arena rim; the rim trims them.
const TIER_ROUTE_23 = 3, TIER_BADGE_CHECK = 6, TIER_SUMMIT = 9;

export const STADIUM_MAPS: StadiumMap[] = [
  {
    id: 'open-cup', name: 'Viridian Gardens', venue: 'FOREST EXHIBITION', difficulty: 'easy',
    description: 'A long garden trail curls back past open clearings. Give your team a second shot.',
    strategy: 'Cover both sides of a bend to attack the same wave twice.',
    theme: 'garden',
    palette: { ground: '#568452', patch: '#659a5c', path: '#e4c58b', edge: '#806544', accent: '#bad77a' },
    buildableRadius: 31, laneWidth: 3.2,
    routes: [[[-30,-12],[-24,-12],[-20,-21],[-9,-21],[-5,-13],[-11,-7],[-19,-1],[-17,9],[-7,13],[1,8],[3,-3],[9,-13],[20,-13],[23,-3],[17,7],[10,15],[10,23],[20,22],[29,13]]],
    obstacles: [
      { x:-14, z:-15, radius:2.7, label:'Old-growth grove', style:'tree' },
      { x:-10, z:3, radius:2.5, label:'Old-growth grove', style:'tree' },
      { x:14, z:-4, radius:2.8, label:'Old-growth grove', style:'tree' },
      { x:-3, z:23, radius:3, label:'Old-growth grove', style:'tree' },
      { x:6, z:-23, radius:2.5, label:'Old-growth grove', style:'tree' },
    ], water: [], bridges: [],
  },
  {
    id: 'boulder-circuit', name: 'Mt. Moon Pass', venue: 'BOULDER TOURNAMENT', difficulty: 'medium',
    description: 'Three switchbacks wind through a rocky pass. The inside corners are precious.',
    strategy: 'Claim the small clearings between hairpins before spreading out.',
    theme: 'canyon',
    palette: { ground:'#877164', patch:'#9f8872', path:'#e6b986', edge:'#594743', accent:'#e6b9f0' },
    buildableRadius:31, laneWidth:3,
    routes: [[[-30,-12],[-21,-19],[4,-19],[17,-13],[14,-5],[-10,-5],[-18,2],[-14,10],[11,10],[18,16],[10,24],[-8,24],[-20,20],[-29,12]]],
    obstacles: [
      { x:-7,z:-12,radius:4.3,label:'Moonstone ridge',style:'rock' },
      { x:4,z:-11,radius:3.4,label:'Moonstone ridge',style:'rock' },
      { x:-5,z:2,radius:4.5,label:'Moonstone ridge',style:'rock' },
      { x:6,z:3,radius:3.7,label:'Moonstone ridge',style:'rock' },
      { x:-8,z:17,radius:3,label:'Moonstone ridge',style:'rock' },
      { x:0,z:18,radius:2.3,label:'Moonstone ridge',style:'rock' },
      { x:24,z:0,radius:4.2,label:'Cliff outcrop',style:'rock' },
      { x:-25,z:-2,radius:3.3,label:'Cliff outcrop',style:'rock' },
    ], water:[], bridges:[],
  },
  {
    id:'cerulean-crossing', name:'Cerulean Crossing', venue:'RIVERSIDE CHALLENGE', difficulty:'medium',
    description:'A winding river divides two banks. Two bridges funnel the wave past the shore.',
    strategy:'Watch the bridge approaches. Water leaves less room for shore defenses.',
    theme:'river',
    palette:{ ground:'#598c78', patch:'#77a38a', path:'#e4cdaa', edge:'#7c775d', accent:'#67dbea' },
    buildableRadius:31, laneWidth:3,
    routes:[[[-30,-14],[-18,-14],[-14,-4],[-22,3],[-18,14],[-8,14],[0,14],[10,14],[20,10],[21,0],[12,-3],[8,-12],[0,-12],[-8,-12],[-8,-22],[7,-25],[18,-20],[29,-12]]],
    water:[{ points:[[-4,-21],[3,-21],[5,-7],[2,4],[5,22],[-3,22],[-5,6],[-3,-5]] }],
    bridges:[{x:0,z:14,width:13,depth:3.8},{x:0,z:-12,width:13,depth:3.8}],
    obstacles:[
      {x:-23,z:-6,radius:2.5,label:'Willow grove',style:'tree'},
      {x:14,z:5,radius:2.8,label:'River boulders',style:'rock'},
      {x:13,z:-17,radius:2.5,label:'Willow grove',style:'tree'},
      {x:-13,z:22,radius:2.5,label:'Willow grove',style:'tree'},
    ],
  },
  {
    id:'power-plant', name:'Power Plant', venue:'DUAL-ENTRY CHALLENGE', difficulty:'hard',
    description:'Two entrances feed separate circuits around the reactor. Every wave uses both.',
    strategy:'Cover the shared junctions, then guard both exits. Enemies alternate entrances.',
    theme:'industrial',
    palette:{ ground:'#435969', patch:'#506775', path:'#a9b9b5', edge:'#253b4c', accent:'#ffcf58' },
    buildableRadius:30, laneWidth:2.8,
    routes:[
      [[-26,-19],[-15,-19],[-13,-9],[-5,-7],[5,-7],[14,-12],[24,-9],[24,3],[16,9],[8,9],[4,17],[10,26]],
      [[26,19],[15,19],[13,9],[5,7],[-5,7],[-14,12],[-24,9],[-24,-3],[-16,-9],[-8,-9],[-4,-17],[-10,-26]],
    ],
    obstacles:[
      {x:0,z:0,radius:4.5,label:'Main reactor',style:'generator'},
      {x:-15,z:1,radius:3.5,label:'Transformer bank',style:'generator'},
      {x:15,z:-1,radius:3.5,label:'Transformer bank',style:'generator'},
      {x:4,z:-21,radius:2.8,label:'Cooling tower',style:'generator'},
      {x:-4,z:21,radius:2.8,label:'Cooling tower',style:'generator'},
    ], water:[], bridges:[],
  },
  {
    id:'indigo-plateau', name:'Indigo Plateau', venue:'VICTORY ROAD ASCENT', difficulty:'hard',
    description:'Challengers leave Victory Road and climb three terraces to the League gate. The stairs slow every climber.',
    strategy:'High ground reaches further down. Stairs are kill zones, but terraces are small. Pick your ledges carefully.',
    theme:'plateau',
    palette:{ ground:'#6f9c52', patch:'#86b35f', path:'#dcb77e', edge:'#9a6b45', accent:'#f2c65a' },
    buildableRadius:31, laneWidth:3,
    terrain:{ plateaus:[
      { label:'Route 23 terrace', height:TIER_ROUTE_23,
        points:[[-40,9],[-24,8],[-12,9.5],[-2,8],[8,8.5],[18,7],[28,10],[40,10],[40,-40],[-40,-40]] },
      // Sentinel Rock: a lone buildable mesa in the meadow, above the entry trail.
      { label:'Sentinel Rock', height:TIER_ROUTE_23,
        points:[[-18.5,14.5],[-15,13.5],[-11.5,15],[-11.5,18.5],[-14.5,20.5],[-18,19.5]] },
      // The east lookout spur hangs over the first stair.
      { label:'Badge-check terrace', height:TIER_BADGE_CHECK,
        points:[[-40,-4],[-24,-5],[-14,-5.5],[-4,-4.5],[8,-4],[18,-4.5],[20,4],[23,6.5],[27,5],[29,-3],[40,-4],[40,-40],[-40,-40]] },
      { label:'Indigo summit', height:TIER_SUMMIT,
        points:[[-13,-23],[-5,-22.2],[5,-22.2],[13,-23],[15,-40],[-15,-40]] },
    ]},
    routes:[[
      [-28,18],[-21,24],[-9,27],[3,27],[13,24],[19,18],
      [15,11,0],[12,4,TIER_ROUTE_23],                  // first stair, cut through the terrace cliff
      [2,2.5],[-10,2.5],[-17,0.5],
      [-19,-3,TIER_ROUTE_23],[-15,-9,TIER_BADGE_CHECK], // second stair
      [-6,-8],[6,-8],[14,-9],[19,-13],[15,-17],[6,-16.5],[2,-16.5],
      [0,-19,TIER_BADGE_CHECK],[0,-26,TIER_SUMMIT],     // the grand Indigo stair
      [0,-29.5],
    ]],
    water:[
      { points:[[-6,9],[-2,9],[-1,15],[1,21],[0.5,30],[1.5,37],[-5,37],[-5,30],[-4.5,22],[-6.5,15]] },
      // Spring-fed pool at the base of the summit cliff, catching the first drop.
      { height:TIER_BADGE_CHECK, points:[[-10,-21.6],[-8.3,-22],[-6.2,-21.5],[-6,-20],[-7.7,-19.3],[-10,-19.7]] },
      // The river down Route 23, fed by the second drop, crossing the road on its way to the falls.
      { height:TIER_ROUTE_23, points:[[-7.4,-4],[-7.6,-2],[-7.2,1],[-6.8,5],[-6.4,8.4],[-2.2,8.4],[-2.6,6],[-3,2.5],[-3.6,-1.8],[-5.2,-4.2]] },
    ],
    bridges:[
      { x:-2, z:27, width:9, depth:3.8, rise:0.9 },
      { x:-5, z:2.5, width:5.5, depth:3.5 },
    ],
    obstacles:[
      { x:-24, z:12, radius:2.6, label:'Viridian pines', style:'pine' },
      { x:7, z:17, radius:2.3, label:'Strength boulder', style:'boulder' },
      { x:7, z:21.6, radius:1, label:'Badge check', style:'brick' },
      { x:9.8, z:29.2, radius:1, label:'Badge check', style:'brick' },
      { x:-23.5, z:3.2, radius:2.8, label:'Pokémon Center', style:'center' },
      { x:-8.5, z:19, radius:1.6, label:'Fallen rockslide', style:'rock' },
      { x:10, z:-12.3, radius:1.2, label:'Strength boulder', style:'boulder' },
      { x:-3, z:-12.5, radius:1.3, label:'Victory Road rubble', style:'rock' },
      { x:-22, z:-15, radius:3, label:'Plateau pines', style:'pine' },
      { x:-10, z:-17, radius:2.2, label:'Plateau pines', style:'pine' },
      { x:25, z:-17, radius:2.2, label:'Plateau pines', style:'pine' },
      { x:-3.6, z:-28, radius:0.9, label:'Indigo pillar', style:'pillar' },
      { x:3.6, z:-28, radius:0.9, label:'Indigo pillar', style:'pillar' },
      { x:-10, z:-27, radius:1.8, label:'Summit pines', style:'pine' },
      { x:10, z:-27, radius:1.8, label:'Summit pines', style:'pine' },
    ],
    decor:[
      { kind:'cave', x:-30, z:16.3, angle:0.86 },
      // The river's source: a spring in the summit's cliff face, cascading down through both lower terraces.
      { kind:'cave', x:-8, z:-23.6, angle:0 },
      { kind:'waterfall', x:-8, z:-23.6, angle:0, width:2.6, top:TIER_SUMMIT, drop:TIER_SUMMIT-TIER_BADGE_CHECK },
      { kind:'waterfall', x:-6.3, z:-4.7, angle:0, width:2.8, top:TIER_BADGE_CHECK, drop:TIER_BADGE_CHECK-TIER_ROUTE_23 },
      { kind:'waterfall', x:-4.2, z:8.4, angle:0, width:3.4, top:TIER_ROUTE_23, drop:TIER_ROUTE_23 },
      { kind:'arch', x:8.4, z:25.4, angle:-1.218, span:8.1, text:'BADGE CHECK' },
      { kind:'arch', x:0, z:-28, angle:0, span:7.2, text:'INDIGO PLATEAU' },
      { kind:'torch', x:-12.5, z:-5.8 }, { kind:'torch', x:-17.8, z:-11.5 },
      { kind:'torch', x:2.6, z:-20.5 }, { kind:'torch', x:-2.6, z:-20.5 },
      { kind:'torch', x:2.4, z:-25.5 }, { kind:'torch', x:-2.4, z:-25.5 },
      { kind:'flowers', x:-12, z:22, radius:2 }, { kind:'flowers', x:14, z:14.5, radius:1.6 },
      { kind:'flowers', x:-26, z:-8, radius:1.8 }, { kind:'flowers', x:6, z:-24.5, radius:1.4 },
    ],
  },
];

export const DEFAULT_STADIUM_MAP = STADIUM_MAPS[0];
