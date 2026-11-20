// Whether a screen pushed right now is being opened FROM one of the two
// layers beside the desks (the calendar, the databases).
//
// Those layers are drawn above every screen, so a pushed screen slides in
// underneath them. They used to vanish the moment the desks lost focus,
// and for the length of the slide the SHARP desk showed where the blurred
// one had been - "стрибок від розмиття до чіткості". Instead the screen is
// pushed with no animation of its own, whole, straight under the layer,
// and the layer dissolves over it (see SideLayer): the desk is never seen.
// Held, not set: two layers each say whether they are out, and neither may
// clear what the other said.
let holders = 0;

export function holdPushFromLayer(): () => void {
  holders += 1;
  return () => {
    holders -= 1;
  };
}

export function pushFromLayer(): boolean {
  return holders > 0;
}
