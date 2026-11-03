// Rotation vector of a shell patch about its center (patchCenter.w = patch radius). The wind leans
// the patch's normal downwind, most for patches seen side-on by the wind; flutter rocks it about a
// per-patch axis so that its rim moves by about flutter * wind strength. A rotation is linear in
// the patch's coordinates, so the motion does not depend on how finely the patch is subdivided.
// It fades with the collapse, where the patches must tile the surface again.
fn patchTilt(patchCenter: vec4f, patchData: vec4f, spheres: texture_2d<f32>, wind: vec4f, tree: vec4f, windPatch: vec4f, lodA: vec4f) -> vec3f {
  let tiltAmount = windPatch.x;
  let flutterAmount = tree.w;
  let near = lodA.x;
  let rand = patchData.y;
  let ci = i32(patchData.w + 0.5);

  let center = textureLoad(spheres, vec2i(ci, 0), 0).xyz;
  let outward = normalize(patchCenter.xyz - center);
  let strength = length(wind.xyz);
  let dir = wind.xyz / max(strength, 0.0001);
  let lean = cross(outward, dir) * (tiltAmount * strength * st_windGust(patchCenter.xyz, wind, tree) * (0.7 + 0.6 * rand));
  let a = rand * 40.0;
  let axis = normalize(cross(outward, vec3f(cos(a), 0.37, sin(a))) + vec3f(0.0001));
  let flutter = axis * (flutterAmount * strength / max(patchCenter.w, 0.01) * sin(wind.w * 5.3 + rand * 61.0));
  return (lean + flutter) * near;
}
