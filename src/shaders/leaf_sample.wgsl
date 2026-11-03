// Alpha sharpening + mip coverage compensation:
// https://bgolus.medium.com/anti-aliased-alpha-test-the-esoteric-alpha-to-coverage-8b177335ae4f
// softness widens the edge ramp beyond one pixel.
// threshold (0..1) shrinks every leaf toward its own center via the leaf core field A; at 1 all leaves are gone.
fn leafSample(tex: texture_2d<f32>, samp: sampler, uv: vec2f, cutoff: f32, mipScale: f32, patchRand: f32, softness: f32, threshold: f32, shrink: vec4f) -> vec4f {
  let leafVariation = shrink.x;
  let shrinkSoftness = max(shrink.y, 0.0001);

  let c = textureSample(tex, samp, uv);
  let texel = uv * vec2f(textureDimensions(tex, 0));
  let dx = dpdx(texel);
  let dy = dpdy(texel);
  let mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
  let coverage = c.r * (1.0 + mip * mipScale);
  // Capping the ramp at 2 * cutoff keeps zero coverage at zero alpha.
  let width = max(max(fwidth(c.r), min(softness, 2.0 * cutoff)), 0.0001);
  let alpha = clamp((coverage - cutoff) / width + 0.5, 0.0, 1.0);

  let core = c.a * mix(1.0, c.g, leafVariation);
  let keep = clamp((core - threshold * (1.0 + shrinkSoftness)) / shrinkSoftness + 1.0, 0.0, 1.0);
  return vec4f(alpha * keep, c.g, c.b, patchRand);
}
