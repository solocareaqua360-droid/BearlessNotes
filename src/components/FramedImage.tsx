import { useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import AttachmentImage from './AttachmentImage';
import { framedRect, type ImageFrame } from '../utils/imageFrame';

// A PICTURE SHOWING ITS FRAME (utils/imageFrame) in whatever box it is given. Without a frame it is the plain `cover` it always
// was. The box is measured, the picture laid out inside it at the frame's size and place, and the box clips the rest.
export default function FramedImage({
  uri,
  driveFileId,
  frame,
  style,
  countsAsUse,
}: {
  uri: string;
  driveFileId?: string;
  frame?: ImageFrame | null;
  style?: StyleProp<ViewStyle>;
  countsAsUse?: boolean;
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  if (!frame) {
    return <AttachmentImage uri={uri} driveFileId={driveFileId} style={[StyleSheet.absoluteFill, style as object]} countsAsUse={countsAsUse} />;
  }
  const rect = box.w > 0 && box.h > 0 ? framedRect(frame, box.w, box.h) : null;
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.clip, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      }}
    >
      {rect && (
        <AttachmentImage
          uri={uri}
          driveFileId={driveFileId}
          resizeMode="stretch"
          style={{ position: 'absolute', left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          countsAsUse={countsAsUse}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
