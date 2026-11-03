// Leaves of the inner ball thin out gradually from its middle to its outline, so that neither the
// outline nor its round shape shows. The fade follows the projected distance from the middle
// (sqrt(1 - facing²) on a sphere) rather than facing itself, which would only thin a narrow band
// at the very edge. The direction from the cluster center is taken alongside the proxy normal so
// that concave creases between lobes, whose normal is also side-on, keep their leaves.
fn innerFadeThreshold(nProxy: vec3f, posLocal: vec3f, center: vec3f, camLocal: vec3f, inner: vec4f, lodD: vec4f) -> f32 {
  let rimWidth = inner.y;
  let thin = inner.z;
  let lodFade = lodD.z;

  let V = normalize(camLocal - posLocal);
  let facing = max(abs(dot(normalize(nProxy), V)), abs(dot(normalize(posLocal - center), V)));
  let r = sqrt(max(1.0 - facing * facing, 0.0));
  return max(mix(thin, 1.0, smoothstep(1.0 - rimWidth, 1.0, r)), lodFade);
}
