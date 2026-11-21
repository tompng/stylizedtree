// Moves a shell point into the inner layer. The cluster's whole shell turns about its center by the
// quaternion in sphere texture row 6, so that inner patches do not sit right behind their outer
// twins, and each patch then moves rigidly along its turned radial direction by innerShift (baked
// per patch), which puts it back at the deepest shell layer of the lobed surface.
fn innerPlace(p: vec3f, patchCenter: vec3f, innerShift: f32, clusterIndex: f32, spheres: texture_2d<f32>) -> vec3f {
  let ci = i32(clusterIndex + 0.5);
  let c = textureLoad(spheres, vec2i(ci, 0), 0).xyz;
  let q = textureLoad(spheres, vec2i(ci, 6), 0);
  return c + st_rotateQuat(p - c, q) + normalize(st_rotateQuat(patchCenter - c, q)) * innerShift;
}
