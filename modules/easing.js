// Pure easing utilities for animation interpolation.
// applyEasing(t, name) maps t∈[0,1] -> [0,1] (or slightly outside for bounce).

export function applyEasing(t, name) {
  switch (name) {
    case 'ease-in':     return t * t;
    case 'ease-out':    return 1 - (1 - t) * (1 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'bounce':      return bounceOut(t);
    default:            return t; // linear
  }
}

export function bounceOut(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { t -= 1.5 / d1;  return n1 * t * t + 0.75; }
  if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
  t -= 2.625 / d1; return n1 * t * t + 0.984375;
}
