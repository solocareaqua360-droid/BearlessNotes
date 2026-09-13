import { RefreshControl } from 'react-native';

// Pull the list down from its top and the search field comes out.
//
// Two attempts at reading that pull as a gesture failed on Android for the
// same underlying reason: at the top the list simply stops, there is no
// overscroll to measure, and a pan of our own either fought the list for
// the touch (and won, freezing it) or was cancelled by it the moment the
// finger moved. The platform already has one gesture that means exactly
// "the finger pulled the top of this list down", handled natively with no
// contest at all - the refresh gesture. This is it, with the search in
// place of a refresh: nothing is ever loading, so the spinner appears
// under the finger and springs straight back.
export function usePullToSearch(onPull: () => void, offset = 0) {
  return {
    listProps: {
      refreshControl: (
        <RefreshControl
          refreshing={false}
          onRefresh={onPull}
          // Below the floating chrome, not behind it.
          progressViewOffset={offset}
          colors={['#ffffff']}
          tintColor="#ffffff"
          progressBackgroundColor="#1b1512"
        />
      ),
    },
  };
}
