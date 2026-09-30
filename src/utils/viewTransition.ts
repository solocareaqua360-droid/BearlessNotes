// A change of layout that should MOVE rather than jump - the laptop's (see
// the .web sibling). Where there is no such thing, the change simply happens.
export function withTransition(update: () => void): void {
  update();
}
