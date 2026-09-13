import { RefreshControl } from 'react-native';
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
      refreshControl: (
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            hapticButtonDown();
            onPull();
          }}
          // Above the first card and off the visible list, so the ring
          // never comes into view even for the instant it would exist.
          progressViewOffset={-60}
          colors={['transparent']}
          tintColor="transparent"
          progressBackgroundColor="transparent"
        />
      ),
    },
  };
}
