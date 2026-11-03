// Inner shade-leaf ball. Unlike the shell, the upper and lower hemispheres have cells of their own
// (2·pattern and 2·pattern + 1, leafAtlas.js 'spheres' layout), so the halves differ yet meet along
// the equator. The uv jumps between the cells there, so the mip gradients come from each
// hemisphere's projection continued smoothly past the equator rather than from the jumping uv.
// The disc radius 0.96 must match DISC in leafAtlas.js.
fn innerLeafSample(tex: texture_2d<f32>, samp: sampler, p: vec3f, clusterIndex: f32, spheres: texture_2d<f32>, cutoff: f32, mipScale: f32, patchRand: f32, softness: f32, threshold: f32, shrink: vec4f) -> vec4f {
  let ci = i32(clusterIndex + 0.5);
  let c = textureLoad(spheres, vec2i(ci, 0), 0).xyz;
  let a = textureLoad(spheres, vec2i(ci, 2), 0).xyz;
  let frame = textureLoad(spheres, vec2i(ci, 3), 0);
  let yaw = frame.z;
  let pattern = floor(frame.w * 0.5);

  let d = normalize((p - c) / a);
  let cs = vec2f(cos(yaw), sin(yaw));
  let xz = vec2f(cs.x * d.x - cs.y * d.z, cs.y * d.x + cs.x * d.z);
  let upperUv = (vec2f(0.5, pattern + 0.5) + 0.5 * 0.96 * xz / sqrt(max(1.0 + d.y, 0.0001))) * 0.5;
  let lowerUv = (vec2f(1.5, pattern + 0.5) + 0.5 * 0.96 * xz / sqrt(max(1.0 - d.y, 0.0001))) * 0.5;
  let lower = d.y < 0.0;
  let uv = select(upperUv, lowerUv, lower);
  let ddx = select(dpdx(upperUv), dpdx(lowerUv), lower);
  let ddy = select(dpdy(upperUv), dpdy(lowerUv), lower);
  let leaf = st_leafSampleGrad(tex, samp, uv, ddx, ddy, cutoff, mipScale, softness, threshold, shrink);
  return vec4f(leaf.xyz, patchRand);
}
