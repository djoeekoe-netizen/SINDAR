/** دوال التيسر (Easing) للأنيميشن */

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5)
}

/** نابض بارتداد — لإحساس 3D Pop */
export function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
