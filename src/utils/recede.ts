import { makeMutable, withSpring, withTiming, Easing } from 'react-native-reanimated';

// THE APP STEPS BACK UNDER A SHEET (2026-10-25, the four windows, sketch DfLTR1bjbvBev8Nj9KnFDY «Аркуш знизу»): while a sheet
// stands over the screens, the screens shrink a little and round their corners, the way iOS does - the sheet is in front,
// the rest is behind it. 0 = as is, 1 = stepped back. Counted, so two sheets over each other do not undo each other.
export const recede = makeMutable(0);
let holders = 0;

export function holdRecede(): () => void {
  holders += 1;
  recede.value = withSpring(1, { damping: 26, stiffness: 260, mass: 0.9 });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) recede.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
  };
}
