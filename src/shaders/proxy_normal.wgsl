// Evaluated per fragment from the rest position, so every LOD representation that covers the
// same point gets the same normal regardless of how coarse its triangles are.
fn proxyNormal(p: vec3f, clusterIndex: f32, merge: f32, spheres: texture_2d<f32>, counts: vec4f) -> vec3f {
  let clusterCount = i32(counts.x + 0.5);
  let crownSmooth = counts.z;
  let lobeCount = i32(counts.w + 0.5);
  var n = vec3f(0.0, 1.0, 0.0);
  if (merge < 1.0) {
    n = st_clusterNormal(p, i32(clusterIndex + 0.5), spheres, lobeCount);
  }
  if (merge > 0.0) {
    n = normalize(mix(n, st_crownNormal(p, spheres, clusterCount, lobeCount, crownSmooth), merge));
  }
  return n;
}
