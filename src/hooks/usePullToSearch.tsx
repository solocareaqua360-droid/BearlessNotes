import { useEffect } from 'react';
import { Keyboard, RefreshControl } from 'react-native';
import { hapticButtonDown } from '../utils/haptics';

// Pull the list down from its top and the search field comes out.
//
// Two attempts at reading that pull as a gesture of our own failed on
// Android for the same reason: at the top the list simply stops, there is
// no overscroll to measure, and a pan either fought the list for the touch
// (and won, freezing it) or was cancelled by it the moment the finger
// moved. The platform already has one gesture that means exactly "the
// finger pulled the top of this list down", handled natively with no
// contest at all - the refresh gesture. This is it, with the search in
// place of a refresh.
//
// And with no ring: nothing is loading, so a spinner would only announce
// a wait that does not exist. Every colour it draws with is transparent
// and it is positioned off the top of the list, so the gesture is felt
// rather than watched - a tick of haptics at the moment the field opens,
// which is the moment the finger lifts.
export function usePullToSearch(onPull: () => void) {
  return {
    listProps: {
      // A tap on anything that is not a card, and a drag of the list
      // itself, both put the keyboard away - which is what closes the
      // field, since an empty search closes with its keyboard (see
      // useSearchDismissal). Taps on a card still reach the card.
      keyboardShouldPersistTaps: 'handled' as const,
      keyboardDismissMode: 'on-drag' as const,
      refreshControl: (
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            hapticButtonDown();
            onPull();
          }}
          // The ring starts this far ABOVE the list and travels down with
          // the finger. The gesture fires at about 64dp of pull, so at
          // -300 it is still far off-screen when the search opens - it
          // never comes into view at all. -60 was not enough: it simply
          // slid in from the top edge instead of from under the chrome.
          progressViewOffset={-300}
          // Belt and braces, in case a build ever clamps that offset:
          // every colour it could draw with is fully transparent.
          colors={['#00000000']}
          tintColor="#00000000"
          progressBackgroundColor="#00000000"
        />
      ),
    },
  };
}

// The search field closes itself when it is done being used: when the
// keyboard goes away with nothing typed (a tap anywhere outside it, or the
// back gesture), and whenever the screen stops being the one on show - a
// swipe to the next tab leaves no field hanging open behind it.
//
// An empty field only: once something has been typed, the results are what
// the user is looking at, and dismissing the keyboard to see more of them
// must not throw the search away.
export function useSearchDismissal({
  isSearching,
  query,
  isFocused,
  close,
}: {
  isSearching: boolean;
  query: string;
  isFocused: boolean;
  close: () => void;
}) {
  useEffect(() => {
    if (!isSearching) return;
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (query.trim().length === 0) close();
    });
    return () => subscription.remove();
  }, [isSearching, query, close]);

  useEffect(() => {
    if (!isFocused && isSearching) {
      Keyboard.dismiss();
      close();
    }
  }, [isFocused, isSearching, close]);
}
