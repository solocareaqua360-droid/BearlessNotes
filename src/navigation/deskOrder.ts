import { useNavigation } from '@react-navigation/native';

// The four desks in the order the dock and the swipe walk them - the same
// names, in the same order, as TAB_SCREENS (tabScreens.tsx). Kept apart
// from that list so a screen can ask "which desk is before me" without
// importing every screen in the app (tabScreens imports them all, and a
// screen importing it back is a cycle).
export const DESK_ORDER = ['Документи', 'Календар', 'Дошки', 'Більше'] as const;
export type DeskName = (typeof DESK_ORDER)[number];

// The way back from a desk's own root, which has no stack to pop: the desk
// before it in the ring - the user's own rule, "на попередній робочий
// стіл, у випадку дошок це календар". Null on the first desk, which has
// nothing before it; the back bead stays there, dimmed.
export function useGoToPreviousDesk(desk: DeskName): (() => void) | null {
  const navigation = useNavigation();
  const index = DESK_ORDER.indexOf(desk);
  if (index <= 0) return null;
  const previous = DESK_ORDER[index - 1];
  // `navigate` climbs out of a nested stack (the boards) to the tab
  // navigator that knows the desk's name.
  return () => (navigation as unknown as { navigate: (name: string) => void }).navigate(previous);
}
