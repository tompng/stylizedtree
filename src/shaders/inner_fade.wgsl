// Leaves of the inner layer thin out gradually from the cluster's middle to its outline: the shell
// is sparse toward the outline, where the layer would show as a dark rim, and its curled rims could
// reach past the shell there. The fade follows the projected distance from the middle
// (sqrt(1 - facing²) on a sphere) rather than facing itself, which would only thin a narrow band
// at the very edge. The direction from the cluster center is taken alongside the proxy normal so
// that concave creases between lobes, whose normal is also side-on, keep their leaves.
fn innerFadeThreshold(nProxy: vec3f, posLocal: vec3f, clusterIndex: f32, spheres: texture_2d<f32>, camLocal: vec3f, inner: vec4f, lodFade: f32) -> f32 {
  let rimWidth = inner.y;
  let thin = inner.z;

  let center = textureLoad(spheres, vec2i(i32(clusterIndex + 0.5), 0), 0).xyz;
  let V = normalize(camLocal - posLocal);
  let facing = max(abs(dot(normalize(nProxy), V)), abs(dot(normalize(posLocal - center), V)));
  let r = sqrt(max(1.0 - facing * facing, 0.0));
  return max(mix(thin, 1.0, smoothstep(1.0 - rimWidth, 1.0, r)), lodFade);
}
