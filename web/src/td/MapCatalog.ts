/** Data-driven TD layouts. Gameplay blockers are deliberately mesh-independent. */
export type MapDifficulty = 'easy' | 'medium' | 'hard';
export type ObstacleStyle = 'none' | 'rock' | 'fountain' | 'generator';

export interface MapObstacle { x: number; z: number; radius: number; label: string; style: ObstacleStyle; }
export interface StadiumMap {
  id: string; name: string; venue: string; difficulty: MapDifficulty;
  description: string; buildableRadius: number; obstacles: MapObstacle[];
}

export const STADIUM_MAPS: StadiumMap[] = [
  { id: 'open-cup', name: 'Open Cup Arena', venue: 'Stadium Exhibition Court', difficulty: 'easy', description: 'A broad broadcast pitch with room to learn ranges and coverage.', buildableRadius: 31, obstacles: [] },
  { id: 'boulder-circuit', name: 'Boulder Circuit', venue: 'Brock Gym Leader Castle', difficulty: 'medium', description: 'Stone formations split the best firing positions into smaller pockets.', buildableRadius: 31, obstacles: [
    { x: -7, z: -4, radius: 3.1, label: 'Boulder cluster', style: 'rock' },
    { x: 6.5, z: 5.5, radius: 3.4, label: 'Boulder cluster', style: 'rock' },
    { x: 1, z: -13, radius: 2.7, label: 'Boulder cluster', style: 'rock' },
  ] },
  { id: 'power-plant', name: 'Power Plant Floor', venue: 'Tournament Service Level', difficulty: 'hard', description: 'Generators reserve the central firing lanes; plan coverage from the edges.', buildableRadius: 29, obstacles: [
    { x: -9, z: -7, radius: 3, label: 'Power generator', style: 'generator' },
    { x: 0, z: 1, radius: 4.4, label: 'Main transformer', style: 'generator' },
    { x: 10, z: 7, radius: 3, label: 'Power generator', style: 'generator' },
    { x: 5, z: -13, radius: 2.4, label: 'Cooling fountain', style: 'fountain' },
  ] },
];

export const DEFAULT_STADIUM_MAP = STADIUM_MAPS[0];
