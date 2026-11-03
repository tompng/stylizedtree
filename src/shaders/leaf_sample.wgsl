fn leafSample(tex: texture_2d<f32>, samp: sampler, uv: vec2f, cutoff: f32, mipScale: f32, patchRand: f32, softness: f32, threshold: f32, shrink: vec4f) -> vec4f {
  let leaf = st_leafSampleGrad(tex, samp, uv, dpdx(uv), dpdy(uv), cutoff, mipScale, softness, threshold, shrink);
  return vec4f(leaf.xyz, patchRand);
}
