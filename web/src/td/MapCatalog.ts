/** Authored courses: routes, terrain and collision all share these definitions. */
export type MapDifficulty = 'easy' | 'medium' | 'hard';
export type MapPoint = readonly [x: number, z: number];
export type ObstacleStyle = 'rock' | 'tree' | 'generator';

export interface MapObstacle {
  x: number; z: number; radius: number; label: string; style: ObstacleStyle;
}
export interface WaterRegion { points: MapPoint[]; }
export interface MapBridge { x: number; z: number; width: number; depth: number; }
export interface StadiumMap {
  id: string;
  name: string;
  venue: string;
  difficulty: MapDifficulty;
  description: string;
  strategy: string;
  theme: 'garden' | 'canyon' | 'river' | 'industrial';
  palette: { ground: string; patch: string; path: string; edge: string; accent: string };
  buildableRadius: number;
  laneWidth: number;
  routes: MapPoint[][];
  obstacles: MapObstacle[];
  water: WaterRegion[];
  bridges: MapBridge[];
}

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
];

export const DEFAULT_STADIUM_MAP = STADIUM_MAPS[0];
