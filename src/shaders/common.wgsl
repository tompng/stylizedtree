fn st_hash11(x: f32) -> f32 {
  return fract(sin(x * 12.9898 + 4.1414) * 43758.5453);
}

fn st_hash21(p: vec2f) -> f32 {
  var q = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  q = q + dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn st_hash31(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q = q + dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}

fn st_noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = st_hash21(i);
  let b = st_hash21(i + vec2f(1.0, 0.0));
  let c = st_hash21(i + vec2f(0.0, 1.0));
  let d = st_hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn st_noise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let x00 = mix(st_hash31(i), st_hash31(i + vec3f(1.0, 0.0, 0.0)), u.x);
  let x10 = mix(st_hash31(i + vec3f(0.0, 1.0, 0.0)), st_hash31(i + vec3f(1.0, 1.0, 0.0)), u.x);
  let x01 = mix(st_hash31(i + vec3f(0.0, 0.0, 1.0)), st_hash31(i + vec3f(1.0, 0.0, 1.0)), u.x);
  let x11 = mix(st_hash31(i + vec3f(0.0, 1.0, 1.0)), st_hash31(i + vec3f(1.0, 1.0, 1.0)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn st_fbm2(p: vec2f) -> f32 {
  return st_noise2(p) * 0.55
    + st_noise2(p * 2.07 + vec2f(17.3, 9.1)) * 0.3
    + st_noise2(p * 4.13 + vec2f(3.7, 41.9)) * 0.15;
}

fn st_fbm3(p: vec3f) -> f32 {
  return st_noise3(p) * 0.55
    + st_noise3(p * 2.07 + vec3f(17.3, 9.1, 5.7)) * 0.3
    + st_noise3(p * 4.13 + vec3f(3.7, 41.9, 23.3)) * 0.15;
}

fn st_windOffset(anchor: vec3f, wind: vec4f, tree: vec4f) -> vec3f {
  let treeHeight = tree.x;
  let phase = tree.y + dot(anchor.xz, vec2f(0.23, 0.19));
  let gust = tree.z;
  let time = wind.w;
  let strength = length(wind.xyz);
  let dir = wind.xyz / max(strength, 0.0001);
  let side = vec3f(-dir.z, 0.0, dir.x);
  let h = clamp(anchor.y / max(treeHeight, 0.1), 0.0, 1.5);
  let sway = gust + 0.3 * sin(time * 1.35 + phase) + 0.12 * sin(time * 2.6 + phase * 1.9);
  let lateral = 0.16 * sin(time * 0.87 + phase * 2.3);
  var offset = (dir * sway + side * lateral) * (strength * h * h);
  offset.y = offset.y - dot(offset.xz, offset.xz) * 0.5 / max(anchor.y, 1.0);
  return offset;
}

fn st_clusterWobble(seed: f32, wind: vec4f, tree: vec4f) -> vec3f {
  let time = wind.w;
  let w = vec3f(sin(time * 1.9 + seed * 37.0), 0.5 * sin(time * 2.4 + seed * 53.0), sin(time * 1.6 + seed * 71.0));
  return w * (0.05 * length(wind.xyz) * (0.4 + tree.z));
}

fn st_sunVisibility(p: vec3f, sunDir: vec3f, spheres: texture_2d<f32>, row: i32, count: i32, density: f32, softness: f32) -> f32 {
  var vis = 1.0;
  for (var i = 0; i < count; i = i + 1) {
    let s = textureLoad(spheres, vec2i(i, row), 0);
    let oc = s.xyz - p;
    let t = dot(oc, sunDir);
    let d = sqrt(max(dot(oc, oc) - t * t, 0.0));
    let r = s.w;
    var o = 1.0 - smoothstep(r * (1.0 - softness), r * (1.0 + 0.25 * softness), d);
    o = o * smoothstep(0.0, r * 0.8, t);
    vis = vis * (1.0 - o * density);
  }
  return vis;
}

fn st_ramp3(x: f32, e1: f32, e2: f32, soft: f32, c0: vec3f, c1: vec3f, c2: vec3f) -> vec3f {
  let t1 = smoothstep(e1 - soft, e1 + soft, x);
  let t2 = smoothstep(e2 - soft, e2 + soft, x);
  return mix(mix(c0, c1, t1), c2, t2);
}

fn st_fogColor(viewDir: vec3f, sunDir: vec3f, horizon: vec3f, sunHaze: vec3f) -> vec3f {
  let haze = pow(max(dot(viewDir, sunDir), 0.0), 8.0);
  return mix(horizon, sunHaze, haze * 0.6);
}

fn st_applyFog(color: vec3f, camToPoint: vec3f, sunDir: vec3f, horizon: vec3f, sunHaze: vec3f, density: f32) -> vec3f {
  let dist = length(camToPoint);
  let f = 1.0 - exp(-dist * density);
  let fogColor = st_fogColor(camToPoint / max(dist, 0.0001), sunDir, horizon, sunHaze);
  return mix(color, fogColor, f);
}

// Same field as CrownField in JS (IQ ellipsoid approximation + polynomial smooth min).
fn st_ellipsoidSdf(q: vec3f, a: vec3f) -> f32 {
  let k0 = length(q / a);
  let k1 = length(q / (a * a));
  return k0 * (k0 - 1.0) / max(k1, 0.000001);
}

fn st_smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

fn st_crownSdf(p: vec3f, spheres: texture_2d<f32>, count: i32, k: f32) -> f32 {
  var d = 0.0;
  for (var i = 0; i < count; i = i + 1) {
    let c = textureLoad(spheres, vec2i(i, 0), 0).xyz;
    let a = textureLoad(spheres, vec2i(i, 2), 0).xyz;
    let e = st_ellipsoidSdf(p - c, a);
    d = select(st_smin(d, e, k), e, i == 0);
  }
  return d;
}

fn st_crownNormal(p: vec3f, spheres: texture_2d<f32>, count: i32, k: f32) -> vec3f {
  let e = vec2f(1.0, -1.0) * 0.02;
  return normalize(
    e.xyy * st_crownSdf(p + e.xyy, spheres, count, k) +
    e.yyx * st_crownSdf(p + e.yyx, spheres, count, k) +
    e.yxy * st_crownSdf(p + e.yxy, spheres, count, k) +
    e.xxx * st_crownSdf(p + e.xxx, spheres, count, k));
}

// Branch chains in row 1: each texel is (point, radius); a negative radius starts a new chain.
// Closest points between the sun ray and each segment: Ericson, Real-Time Collision Detection 5.1.9.
fn st_woodVisibility(p: vec3f, sunDir: vec3f, spheres: texture_2d<f32>, count: i32) -> f32 {
  var vis = 1.0;
  var prev = textureLoad(spheres, vec2i(0, 1), 0);
  for (var i = 1; i < count; i = i + 1) {
    let cur = textureLoad(spheres, vec2i(i, 1), 0);
    if (cur.w > 0.0) {
      let a = prev.xyz;
      let ab = cur.xyz - a;
      let r = p - a;
      let e = dot(ab, ab);
      let f = dot(ab, r);
      let c = dot(sunDir, r);
      let b = dot(sunDir, ab);
      let denom = e - b * b;
      var s = 0.0;
      if (denom > 0.000001) {
        s = max((b * f - c * e) / denom, 0.0);
      }
      var t = (b * s + f) / max(e, 0.000001);
      if (t < 0.0) {
        t = 0.0;
        s = max(-c, 0.0);
      } else if (t > 1.0) {
        t = 1.0;
        s = max(b - c, 0.0);
      }
      let dist = length(p + sunDir * s - (a + ab * t));
      let radius = mix(abs(prev.w), cur.w, t);
      let o = (1.0 - smoothstep(radius * 0.75, radius * 1.15, dist)) * smoothstep(0.0, radius, s);
      vis = vis * (1.0 - o);
    }
    prev = cur;
  }
  return vis;
}
