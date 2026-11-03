import { buildIcosphere } from './icosphere.js';

// Rhombic triacontahedron: one rhombus per icosahedron edge, spanning its two endpoints and the
// centers of the two faces sharing it. Corners are counter-clockwise seen from outside, as
// [c00, c10, c11, c01] in rhombus coordinates (u, v).
export function triacontahedronRhombi() {
  const ico = buildIcosphere(0);
  const faces = ico.levels[0];
  const centers = [];
  const edgeFaces = new Map();
  for (let f = 0; f < faces.length / 3; f++) {
    const [a, b, c] = faces.slice(f * 3, f * 3 + 3);
    centers.push(ico.dirs[a].clone().add(ico.dirs[b]).add(ico.dirs[c]).normalize());
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(p, q) * 100 + Math.max(p, q);
      if (!edgeFaces.has(key)) edgeFaces.set(key, { p, q, faces: [] });
      edgeFaces.get(key).faces.push(f);
    }
  }
  return [...edgeFaces.values()].map(({ p, q, faces: [f1, f2] }) => {
    const a = ico.dirs[p];
    const b = ico.dirs[q];
    let c1 = centers[f1];
    let c2 = centers[f2];
    const normal = c1.clone().sub(a).cross(c2.clone().sub(a));
    if (normal.dot(a.clone().add(b)) < 0) [c1, c2] = [c2, c1];
    return [a, c1, b, c2];
  });
}

export function rhombusPoint([c00, c10, c11, c01], u, v) {
  return c00.clone().multiplyScalar((1 - u) * (1 - v))
    .addScaledVector(c10, u * (1 - v))
    .addScaledVector(c11, u * v)
    .addScaledVector(c01, (1 - u) * v)
    .normalize();
}

// Triangles of one rhombus, as indices into RHOMBUS_POINTS (the four corners, then the center):
// split along the c00-c11 diagonal (an icosahedron edge), or into four around the center.
export const RHOMBUS_POINTS = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]];
export const RHOMBUS_HALVES = [[0, 1, 2], [0, 2, 3]];
export const RHOMBUS_QUARTERS = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]];

// Value at (u, v) of the piecewise-linear function given by `values` at `points` over `triangles`.
// Values are numbers or objects with clone / multiplyScalar / addScaledVector (THREE vectors).
export function interpolateOnTriangles(triangles, points, values, u, v) {
  let best = null;
  for (const [a, b, c] of triangles) {
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const [cx, cy] = points[c];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    const wa = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / det;
    const wb = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / det;
    const wc = 1 - wa - wb;
    const inside = Math.min(wa, wb, wc);
    if (!best || inside > best.inside) best = { inside, weights: [[a, wa], [b, wb], [c, wc]] };
  }
  const [[i0, w0], ...rest] = best.weights;
  if (typeof values[i0] === 'number') return rest.reduce((sum, [i, w]) => sum + values[i] * w, values[i0] * w0);
  return rest.reduce((sum, [i, w]) => sum.addScaledVector(values[i], w), values[i0].clone().multiplyScalar(w0));
}
