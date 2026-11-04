import { clamp, lerp, smoothstep } from '../math.js';

// LOD level L = log2(referencePixels / projected crown radius in px): +1 per doubling of distance,
// negative closer than where the crown radius is referencePixels.
// The *Poly ranges are split evenly between the levels of their mesh (TreeInstance).
export const defaultLodSettings = {
  mode: 'auto',
  manualLevel: 0,
  bias: 0,
  referencePixels: 400,

  collapseStart: 1.4,
  collapseEnd: 3.2,
  // L per shell grid level (shellGridLevel).
  gridLevelSpacing: 0.9,
  woodPolyStart: 2.5,
  woodPolyEnd: 4.5,
  corePolyStart: 3.6,
  corePolyEnd: 5.0,
  innerFadeStart: 3.8,
  innerFadeEnd: 4.4,
  twigFadeStart: 3.8,
  twigFadeEnd: 5.0,
  limbFadeStart: 7.0,
  limbFadeEnd: 8.5,

  cutoffNear: 0.5,
  cutoffFar: 0.22,
};

const progress = (level, start, end) => clamp((level - start) / Math.max(end - start, 1e-3), 0, 1);

export function evaluateLod(level, s) {
  const collapse = smoothstep(s.collapseStart, s.collapseEnd, level);
  const limbScale = 1 - smoothstep(s.limbFadeStart, s.limbFadeEnd, level);
  return {
    level,
    near: 1 - collapse,
    shellActive: level < s.collapseEnd,
    woodPoly: progress(level, s.woodPolyStart, s.woodPolyEnd),
    corePoly: progress(level, s.corePolyStart, s.corePolyEnd),
    cutoff: lerp(s.cutoffNear, s.cutoffFar, collapse),
    innerFade: smoothstep(s.innerFadeStart, s.innerFadeEnd, level),
    limbScale,
    twigScale: 1 - smoothstep(s.twigFadeStart, s.twigFadeEnd, level),
  };
}

// Coming closer, shell grid level k is swapped in at collapseEnd - (k - 1) * gridLevelSpacing,
// still morphed onto level k - 1 (the core mesh for k = 1), and unfolds over the next spacing, so
// each halving of the distance adds about one segment, up to `segments`.
export function shellGridLevel(level, s, segments) {
  const t = (s.collapseEnd - level) / Math.max(s.gridLevelSpacing, 1e-3);
  if (t >= segments) return { level: segments, morph: 0 };
  const k = Math.max(Math.floor(t), 0);
  return { level: k + 1, morph: Math.min(1 - (t - k), 1) };
}
