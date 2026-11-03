// Leaf atlas lookup from the direction of p in the cluster's unit-sphere parameter space.
// Each hemisphere is a disc in Lambert azimuthal equal-area projection (xz / sqrt(1 + |y|));
// the lower one reuses the same disc mirrored, so both halves meet along the equator.
// The disc radius 0.96 must match DISC in leafAtlas.js.
fn leafUv(p: vec3f, clusterIndex: f32, spheres: texture_2d<f32>) -> vec2f {
  let ci = i32(clusterIndex + 0.5);
  let c = textureLoad(spheres, vec2i(ci, 0), 0).xyz;
  let a = textureLoad(spheres, vec2i(ci, 2), 0).xyz;
  let frame = textureLoad(spheres, vec2i(ci, 3), 0);
  let yaw = frame.z;
  let cellIndex = frame.w;

  let d = normalize((p - c) / a);
  let cs = vec2f(cos(yaw), sin(yaw));
  let xz = vec2f(cs.x * d.x - cs.y * d.z, cs.y * d.x + cs.x * d.z);
  let disc = xz / sqrt(1.0 + abs(d.y));
  let cell = vec2f(cellIndex - 2.0 * floor(cellIndex * 0.5), floor(cellIndex * 0.5));
  return (cell + 0.5 + 0.5 * 0.96 * disc) * 0.5;
}
