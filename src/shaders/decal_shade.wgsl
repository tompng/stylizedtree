fn decalShade(local: vec3f, spheres: texture_2d<f32>, counts: vec4f, sun: vec4f, crown: vec4f, camLocal: vec3f, shadowTint: vec3f, aoTint: vec3f, ground: vec4f, fog: vec4f) -> vec4f {
  let strength = ground.x;
  let breakup = ground.y;
  let density = ground.z;
  let softness = ground.w;
  let crownCenter = crown.xyz;
  let crownRadius = crown.w;
  let L = sun.xyz;

  let leafVis = st_sunVisibility(local, L, spheres, 0, i32(counts.x + 0.5), density, softness);
  let woodVis = st_woodVisibility(local, L, spheres, i32(counts.y + 0.5));
  var occ = 1.0 - leafVis;
  let n = st_fbm2(local.xz * 1.6) - 0.5;
  occ = clamp(occ + n * breakup * occ * (1.0 - occ) * 4.0, 0.0, 1.0);
  occ = max(occ, 1.0 - woodVis);

  let groundAo = (1.0 - smoothstep(0.15 * crownRadius, 1.1 * crownRadius, length(local.xz - crownCenter.xz))) * 0.5;
  let fade = exp(-length(camLocal - local) * fog.x);
  let m = mix(vec3f(1.0), shadowTint, occ * strength * fade) * mix(vec3f(1.0), aoTint, groundAo * fade);
  return vec4f(m, 1.0);
}
