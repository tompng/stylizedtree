import { clamp, lerp, smoothstep } from '../math.js';

// LOD level L = log2(referencePixels / projected crown radius in px): +1 per doubling of distance.
// The *Poly ranges are split evenly between the levels of their mesh (TreeInstance).
export const defaultLodSettings = {
  mode: 'auto',
  manualLevel: 0,
  bias: 0,
  referencePixels: 400,

  collapseStart: 1.4,
  collapseEnd: 3.2,
  // The last shell grid level morphs onto the core mesh, which replaces the shell at collapseEnd.
  shellPolyStart: 1.4,
  dissolveEnd: 3.8,
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
    shellPoly: progress(level, s.shellPolyStart, s.collapseEnd),
    woodPoly: progress(level, s.woodPolyStart, s.woodPolyEnd),
    corePoly: progress(level, s.corePolyStart, s.corePolyEnd),
    cutoff: lerp(s.cutoffNear, s.cutoffFar, collapse),
    dissolve: smoothstep(s.collapseEnd, s.dissolveEnd, level) * limbScale,
    innerFade: smoothstep(s.innerFadeStart, s.innerFadeEnd, level),
    limbScale,
    twigScale: 1 - smoothstep(s.twigFadeStart, s.twigFadeEnd, level),
  };
}
