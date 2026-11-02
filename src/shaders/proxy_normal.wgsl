// Evaluated per fragment from the rest position, so every LOD representation that covers the
// same point gets the same normal regardless of how coarse its triangles are.
fn proxyNormal(p: vec3f, clusterIndex: f32, merge: f32, spheres: texture_2d<f32>, counts: vec4f) -> vec3f {
  let clusterCount = i32(counts.x + 0.5);
  let crownSmooth = counts.z;
  var n = vec3f(0.0, 1.0, 0.0);
  if (merge < 1.0) {
    let ci = i32(clusterIndex + 0.5);
    let c = textureLoad(spheres, vec2i(ci, 0), 0).xyz;
    let a = textureLoad(spheres, vec2i(ci, 2), 0).xyz;
    n = normalize((p - c) / (a * a));
  }
  if (merge > 0.0) {
    n = normalize(mix(n, st_crownNormal(p, spheres, clusterCount, crownSmooth), merge));
  }
  return n;
}
