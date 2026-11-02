// Alpha sharpening + mip coverage compensation:
// https://bgolus.medium.com/anti-aliased-alpha-test-the-esoteric-alpha-to-coverage-8b177335ae4f
fn leafSample(tex: texture_2d<f32>, samp: sampler, uv: vec2f, cutoff: f32, mipScale: f32, patchRand: f32) -> vec4f {
  let c = textureSample(tex, samp, uv);
  let texel = uv * vec2f(textureDimensions(tex, 0));
  let dx = dpdx(texel);
  let dy = dpdy(texel);
  let mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
  let coverage = c.r * (1.0 + mip * mipScale);
  let alpha = clamp((coverage - cutoff) / max(fwidth(c.r), 0.0001) + 0.5, 0.0, 1.0);
  return vec4f(alpha, c.g, c.b, patchRand);
}
