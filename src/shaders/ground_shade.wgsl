fn groundShade(posWorld: vec3f, camPos: vec3f, sun: vec4f, cGrass: vec3f, cGrass2: vec3f, cGrassShadow: vec3f, fog: vec4f, cHorizon: vec3f, cSunHaze: vec3f) -> vec4f {
  let p = posWorld.xz;
  let dist = length(posWorld - camPos);
  let detailFade = 1.0 - smoothstep(40.0, 160.0, dist);
  let broadFade = 1.0 - smoothstep(600.0, 2000.0, dist);
  let broad = (st_fbm2(p * 0.06) - 0.5) * broadFade;
  let detail = (st_fbm2(p * 0.7 + vec2f(13.0, 7.0)) - 0.5) * detailFade;
  var col = mix(cGrass, cGrass2, clamp(0.5 + broad * 2.2, 0.0, 1.0));
  col = col * (1.0 + detail * 0.25);
  col = mix(cGrassShadow, col, smoothstep(0.0, 0.3, sun.y));
  col = st_applyFog(col, posWorld - camPos, sun.xyz, cHorizon, cSunHaze, fog.x);
  return vec4f(col, 1.0);
}
