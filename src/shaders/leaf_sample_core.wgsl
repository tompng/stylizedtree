// Alpha sharpening for alpha-to-coverage:
// https://bgolus.medium.com/anti-aliased-alpha-test-the-esoteric-alpha-to-coverage-8b177335ae4f
// edge.x (softness) widens the edge ramp beyond one pixel. edge.z moves the ramp from centered on the
// cutoff (0) to lying wholly below it (1), where all coverage at or above the cutoff stays opaque.
// Once a pixel spans several leaves, the mip-averaged coverage is about the same everywhere, and
// thresholding it would turn the whole layer opaque or clear depending on which side of the cutoff
// the average falls. Over far.y..far.z (mip levels around the leaf width) the alpha therefore
// moves to the averaged coverage scaled by far.x (farCoverageScale in leafAtlas.js), so a distant
// layer is as opaque on average as it is up close and alpha-to-coverage turns that into sample coverage.
// threshold (0..1) shrinks every leaf toward its own center via the leaf core field A; at 1 all leaves are gone.
// Gradients are explicit so a caller whose uv jumps between atlas cells can pass those of a continuous mapping.
fn st_leafSampleGrad(tex: texture_2d<f32>, samp: sampler, uv: vec2f, ddx: vec2f, ddy: vec2f, cutoff: f32, far: vec4f, edge: vec4f, threshold: f32, shrink: vec4f) -> vec4f {
  let softness = edge.x;
  let edgeOutward = edge.z;
  let farScale = far.x;
  let farMipStart = far.y;
  let farMipEnd = far.z;
  let leafVariation = shrink.x;
  let shrinkSoftness = max(shrink.y, 0.0001);

  let c = textureSampleGrad(tex, samp, uv, ddx, ddy);
  let size = vec2f(textureDimensions(tex, 0));
  let dx = ddx * size;
  let dy = ddy * size;
  let mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
  let below = 0.5 + 0.5 * edgeOutward;
  // Capping the ramp at cutoff / below keeps zero coverage at zero alpha.
  let width = max(max(fwidth(c.r), min(softness, cutoff / below)), 0.0001);
  let sharp = clamp((c.r - cutoff) / width + below, 0.0, 1.0);
  let averaged = clamp(c.r * farScale, 0.0, 1.0);
  let alpha = mix(sharp, averaged, smoothstep(farMipStart, farMipEnd, mip));

  let core = c.a * mix(1.0, c.g, leafVariation);
  let keep = clamp((core - threshold * (1.0 + shrinkSoftness)) / shrinkSoftness + 1.0, 0.0, 1.0);
  return vec4f(alpha * keep, c.g, c.b, 0.0);
}
