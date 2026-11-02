import { Vector3 } from 'three/webgpu';

const T = (1 + Math.sqrt(5)) / 2;
const BASE_VERTICES = [
  [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0],
  [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T],
  [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1],
];
const BASE_FACES = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
  1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
  4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];

// Vertices of level N are a superset of level N-1, so one vertex buffer serves every level.
// A vertex born at level N geomorphs toward the midpoint of its parent edge (parents[i]),
// where it lies exactly on the flat level N-1 triangle.
export function buildIcosphere(maxLevel) {
  const dirs = BASE_VERTICES.map(([x, y, z]) => new Vector3(x, y, z).normalize());
  const birth = dirs.map(() => 0);
  const parents = dirs.map(() => null);
  const levels = [BASE_FACES.slice()];

  for (let level = 1; level <= maxLevel; level++) {
    const prev = levels[level - 1];
    const cache = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let index = cache.get(key);
      if (index === undefined) {
        index = dirs.length;
        dirs.push(dirs[a].clone().add(dirs[b]).normalize());
        birth.push(level);
        parents.push([a, b]);
        cache.set(key, index);
      }
      return index;
    };
    const faces = [];
    for (let i = 0; i < prev.length; i += 3) {
      const a = prev[i];
      const b = prev[i + 1];
      const c = prev[i + 2];
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      faces.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    levels.push(faces);
  }
  return { dirs, birth, parents, levels };
}
