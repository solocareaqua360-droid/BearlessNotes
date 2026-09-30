// THE CARD THAT BECOMES THE PAGE (the soft motion, stage 3) - the laptop's;
// see the .web sibling. On a phone a card simply opens.
export function morphKey(_key: string, _part?: 'child'): object {
  return {};
}

export function morph(_key: string, update: () => void): void {
  update();
}

// Several of these markers on one element, merged - each is a `dataSet`,
// and two spread side by side would leave only the last.
export function dataSets(...parts: object[]): object {
  const dataSet = Object.assign({}, ...parts.map((p) => (p as { dataSet?: object }).dataSet ?? {}));
  return Object.keys(dataSet).length ? { dataSet } : {};
}
