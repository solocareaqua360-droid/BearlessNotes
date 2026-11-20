// A card that rises a little under the pointer and settles when pressed -
// the motion itself is one CSS rule in App.web.tsx ([data-lift]).
export function lift(): object {
  return { dataSet: { lift: '1' } };
}
