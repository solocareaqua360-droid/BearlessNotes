import { useNavigation } from '@react-navigation/native';
import ThoughtsSpace from '../components/thoughts/ThoughtsSpace';
import { useThoughts } from '../hooks/useThoughts';
import { openThoughtCapture } from '../utils/thoughtBus';

// «ДУМКИ» AS A SCREEN OF ITS OWN (the Mac's frame B, 2026-10-19, the user's: a section in the sidebar is a place one
// stands in, not a window over another place). The same space the phone opens over its desk (ThoughtsHost's) - here it
// is a route in the stack, so the sidebar can light it and «Назад» means what it means everywhere: one level down.
export default function ThoughtsScreen() {
  const navigation = useNavigation();
  const { themes, thoughts, countOf } = useThoughts(true);
  return (
    <ThoughtsSpace
      visible
      inline
      themes={themes}
      thoughts={thoughts}
      countOf={countOf}
      onCatch={(themeId) => openThoughtCapture({ themeId })}
      onClose={() => {
        if (navigation.canGoBack()) navigation.goBack();
      }}
    />
  );
}
