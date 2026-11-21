import { clamp, smoothstep } from '../math.js';

// LOD level L = log2(referencePixels / projected crown radius in px): +1 per doubling of distance,
// negative closer than where the crown radius is referencePixels.
// The *Poly ranges are split evenly between the levels of their mesh (TreeInstance).
export const defaultLodSettings = {
  mode: 'auto',
  manualLevel: 0,
  bias: 0,
  referencePixels: 400,

  // Beyond this L the shell is drawn as rhombus cards (shellGridLevel).
  mergeEnd: 3.2,
  // L per shell grid level.
  gridLevelSpacing: 0.9,
  woodPolyStart: 2.5,
  woodPolyEnd: 4.5,
  innerFadeStart: 3.8,
  innerFadeEnd: 4.4,
  // The inner layer draws the shell's grid level up to this one (0 = the rhombus cards).
  innerMaxLevel: 1,
  twigFadeStart: 3.8,
  twigFadeEnd: 5.0,
  limbFadeStart: 7.0,
  limbFadeEnd: 8.5,

  cutoff: 0.5,
};

const progress = (level, start, end) => clamp((level - start) / Math.max(end - start, 1e-3), 0, 1);

export function evaluateLod(level, s) {
  return {
    level,
    woodPoly: progress(level, s.woodPolyStart, s.woodPolyEnd),
    innerFade: smoothstep(s.innerFadeStart, s.innerFadeEnd, level),
    limbScale: 1 - smoothstep(s.limbFadeStart, s.limbFadeEnd, level),
    twigScale: 1 - smoothstep(s.twigFadeStart, s.twigFadeEnd, level),
  };
}

// Coming closer, shell grid level k is swapped in at mergeEnd - (k - 1) * gridLevelSpacing, still
// morphed onto level k - 1 (the rhombus cards, level 0, for k = 1), and unfolds over the next
// spacing, so each halving of the distance adds about one segment, up to `segments`.
export function shellGridLevel(level, s, segments) {
  const t = (s.mergeEnd - level) / Math.max(s.gridLevelSpacing, 1e-3);
  if (t < 0) return { level: 0, morph: 0 };
  if (t >= segments) return { level: segments, morph: 0 };
  const k = Math.floor(t);
  return { level: k + 1, morph: 1 - (t - k) };
}
