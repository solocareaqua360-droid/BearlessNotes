import { ActivityIndicator, Image, ImageResizeMode, StyleProp, StyleSheet, View, ImageStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAttachmentSource } from '../hooks/useAttachmentSource';

// A picture that lives on the phone, drawn wherever the app is running.
//
// Every photo, sticker, cover and thumbnail in this app is stored as a
// path on the phone's disk - file:///data/user/0/... - and for a while
// every one of them was drawn with a plain <Image source={{ uri }}>. On
// the phone that is the picture. In a browser it is a path the page may
// not open, and the frame stays empty: "зображення є тільки на дошці",
// because the board and the editor were the two places that had been
// taught to ask for an address instead of trusting the path.
//
// So this is the one place that knows. It hands the uri and the Drive
// id to useAttachmentSource, which on the phone answers with the path
// at once and in a browser fetches the Drive copy into a blob - and it
// draws what comes back. Twelve call sites, one lookup, no branching
// anywhere else.
//
// `source` decides, not `status`: on the phone the source is there on
// the first render, so nothing flickers through a spinner that did not
// use to be there. Only where there is genuinely nothing yet to draw -
// a browser waiting on Drive, a copy gone from the device - does the
// frame show its state instead.
export default function AttachmentImage({
  uri,
  driveFileId,
  style,
  resizeMode = 'cover',
  // A picture in a grid being scrolled past is not someone looking at it
  // - see attachmentCache. Only a note that carries the picture says so.
  countsAsUse = false,
}: {
  uri: string;
  driveFileId?: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  countsAsUse?: boolean;
}) {
  const { status, source } = useAttachmentSource(uri, driveFileId, countsAsUse);
  if (source) return <Image source={{ uri: source }} style={style} resizeMode={resizeMode} />;
  return (
    <View style={[style, styles.frame]}>
      {status === 'missing' ? (
        <Ionicons name="cloud-offline-outline" size={20} color="#9CA3AF" />
      ) : (
        <ActivityIndicator color="#9CA3AF" size="small" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
});
