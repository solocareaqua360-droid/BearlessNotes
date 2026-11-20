// AN ANGLE AS REANIMATED'S NATIVE SIDE READS IT (2026-10-24, the «гола заставка» bug): a rotation goes to the native
// side as a string («12deg») and is read back with C++'s std::stod, which THROWS on a number too small for a normal
// double (5e-324 and the like - what an easing or a product of small factors gives a moment before it reaches 0).
// That throw is not caught anywhere: React Native destroys the whole app's surface and only the phone's wallpaper is
// left (the app's window shows it). Tiny angles are drawn as 0, and a non-number as 0 too.
export function deg(v: number): string {
  'worklet';
  return `${Number.isFinite(v) && Math.abs(v) > 1e-6 ? v : 0}deg`;
}
export function rad(v: number): string {
  'worklet';
  return `${Number.isFinite(v) && Math.abs(v) > 1e-8 ? v : 0}rad`;
}
