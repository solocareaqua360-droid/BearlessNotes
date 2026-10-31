// How closely things should be packed: by what is POINTING at them.
//
// Not by width, and that distinction is the whole reason this exists.
// `useResponsiveLayout` keys off width and is right to - a Fold's inner
// screen is 704dp and genuinely wants two columns. But that screen is
// 704dp and TOUCHED, while a Mac is 1440 and POINTED. Tie the size of a
// control to width and the Fold's controls shrink under the user's own
// thumb, which is worse than the problem being solved.
//
// A finger needs about 44 points to hit reliably; a cursor needs the
// pixel it is on. That is the difference this measures, and nothing
// else.
export type Density = 'touch' | 'pointer';

export function useDensity(): Density {
  return 'touch';
}
