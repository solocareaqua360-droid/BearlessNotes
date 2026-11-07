// WHERE THE VIDEO SITS ON THE WATCH SCREEN: at the very top, under the status
// bar, full width for a wide (YouTube) video; a TikTok one is tall, so it is
// capped at half-plus of the screen and centred. `blockH` is the black block
// the screen reserves for it (status bar included); the player itself is drawn
// by PlayerHost, above every screen, into the same box.
export function watchBox(width: number, height: number, insetTop: number, wide: boolean) {
  const ratio = wide ? 16 / 9 : 9 / 16;
  const h = wide ? width / ratio : Math.min(height * 0.55, width / ratio);
  const w = wide ? width : h * ratio;
  return { left: (width - w) / 2, top: insetTop, w, h, blockH: insetTop + h };
}
