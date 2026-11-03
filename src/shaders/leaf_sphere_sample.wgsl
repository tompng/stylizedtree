// Leaf atlas lookup from the direction of p in the cluster's unit-sphere parameter space, turned
// by the cluster's random rotation. Pattern k has its upper hemisphere in cell 2k and its lower
// hemisphere in cell 2k + 1 (leafAtlas.js), each a disc in Lambert azimuthal equal-area projection
// (xz / sqrt(1 + |y|)) with radius 0.96 matching DISC there. The uv jumps between the two cells at
// the equator, so the mip gradients come from each hemisphere's projection continued smoothly past
// the equator rather than from the jumping uv.
fn leafSphereSample(tex: texture_2d<f32>, samp: sampler, p: vec3f, clusterIndex: f32, spheres: texture_2d<f32>, cutoff: f32, mipScale: f32, patchRand: f32, softness: f32, threshold: f32, shrink: vec4f) -> vec4f {
  let ci = i32(clusterIndex + 0.5);
  let c = textureLoad(spheres, vec2i(ci, 0), 0).xyz;
  let a = textureLoad(spheres, vec2i(ci, 2), 0).xyz;
  let pattern = textureLoad(spheres, vec2i(ci, 3), 0).z;
  let q = textureLoad(spheres, vec2i(ci, 4), 0);

  let d0 = normalize((p - c) / a);
  let d = d0 + 2.0 * cross(q.xyz, cross(q.xyz, d0) + q.w * d0);
  let upperUv = (vec2f(0.5, pattern + 0.5) + 0.5 * 0.96 * d.xz / sqrt(max(1.0 + d.y, 0.0001))) * 0.5;
  let lowerUv = (vec2f(1.5, pattern + 0.5) + 0.5 * 0.96 * d.xz / sqrt(max(1.0 - d.y, 0.0001))) * 0.5;
  let lower = d.y < 0.0;
  let uv = select(upperUv, lowerUv, lower);
  let ddx = select(dpdx(upperUv), dpdx(lowerUv), lower);
  let ddy = select(dpdy(upperUv), dpdy(lowerUv), lower);
  let leaf = st_leafSampleGrad(tex, samp, uv, ddx, ddy, cutoff, mipScale, softness, threshold, shrink);
  return vec4f(leaf.xyz, patchRand);
}
