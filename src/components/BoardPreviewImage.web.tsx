import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import AttachmentImage from './AttachmentImage';

// The browser keeps no files of its own: the picture comes the way every
// attachment does there (see BoardPreviewImage for the phone's reasons).
export default function BoardPreviewImage({
  uri,
  driveFileId,
  fallback,
}: {
  boardId: string;
  uri?: string;
  driveFileId?: string;
  fallback: ReactNode;
}) {
  if (!uri) return <View style={StyleSheet.absoluteFill}>{fallback}</View>;
  return <AttachmentImage uri={uri} driveFileId={driveFileId} style={StyleSheet.absoluteFill} countsAsUse={false} />;
}
