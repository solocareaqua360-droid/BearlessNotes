import { useEffect, useState } from 'react';
import { Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import type { Block } from '../types';
import GlassLayer from './GlassLayer';
import AttachmentImage from './AttachmentImage';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { formatUpdatedAt } from '../utils/documentPreview';

// A geoточка's own record, opened by a tap that used to just launch
// Google Maps straight away - that is now one button inside here
// ("Перейти в Google Maps"), not what the tap itself does. The same
// two fields a Task carries for the same reason (see TasksScreen's own
// Task.comment/attachments): a short note and whatever photos were
// attached, both belonging to the point rather than to any one document
// that references it.
export type GeoDetailLink = {
  id: string;
  url: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  comment?: string;
  attachments?: Block[];
};

export default function GeoPointDetailSheet({
  link,
  onClose,
  onSaveComment,
  onAddPhoto,
  onRemovePhoto,
}: {
  link: GeoDetailLink | null;
  onClose: () => void;
  onSaveComment: (comment: string) => void;
  onAddPhoto: () => void;
  onRemovePhoto: (attachmentId: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [comment, setComment] = useState(link?.comment ?? '');
  // The closing tap sends `link` to null in the same render that sends
  // GlassLayer's `visible` to false - content would otherwise blank out
  // a beat before the card has even started fading, which reads as a
  // flash. This keeps the last real point on screen through that
  // animation; GlassLayer's own `visible` is still what decides whether
  // any of it shows at all.
  const [shown, setShown] = useState(link);
  useEffect(() => {
    if (link) setShown(link);
  }, [link]);

  useEffect(() => {
    setComment(link?.comment ?? '');
  }, [link?.id, link?.comment]);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // driveFileId alone (no local imageUri yet - a photo not restored from
  // Drive on this device) still has something for AttachmentImage to
  // show; only a block with neither has nothing to draw at all.
  const photos = (shown?.attachments ?? []).filter(
    (a) => (a.type ?? 'paragraph') === 'image' && (a.imageUri || a.driveFileId)
  );

  return (
    <GlassLayer visible={link !== null} onClose={onClose} intensity={60}>
      <View style={styles.frame} pointerEvents="box-none">
        <View style={[styles.card, { marginBottom: keyboardHeight }]}>
          {shown && (
            <>
              <View style={styles.header}>
                <Text style={styles.title} numberOfLines={2}>
                  {shown.title || 'Геоточка'}
                </Text>
                <Pressable hitSlop={8} onPress={onClose}>
                  <Ionicons name="close" size={22} color={theme.ink.muted} />
                </Pressable>
              </View>

              {!!(shown.createdAt ?? shown.updatedAt) && (
                <Text style={styles.date}>
                  Створено {formatUpdatedAt((shown.createdAt ?? shown.updatedAt) as number)}
                </Text>
              )}

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carousel}>
                {photos.map((photo) => (
                  <View key={photo.id} style={styles.photoWrap}>
                    <AttachmentImage
                      uri={photo.imageUri ?? ''}
                      driveFileId={photo.driveFileId}
                      style={styles.photo}
                      resizeMode="cover"
                    />
                    <Pressable
                      style={styles.photoRemove}
                      hitSlop={8}
                      onPress={() => onRemovePhoto(photo.id)}
                    >
                      <Ionicons name="close" size={13} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                <Pressable style={styles.photoAdd} onPress={onAddPhoto}>
                  <Ionicons name="add" size={22} color={theme.accent} />
                </Pressable>
              </ScrollView>

              <TextInput
                value={comment}
                onChangeText={setComment}
                onBlur={() => onSaveComment(comment)}
                placeholder="Запис"
                placeholderTextColor={theme.ink.faint}
                style={styles.commentInput}
                multiline
              />

              <Pressable
                style={({ pressed }) => [styles.mapsButton, pressed && styles.pressed]}
                onPress={() => Linking.openURL(shown.url).catch(() => {})}
              >
                <Ionicons name="navigate-outline" size={17} color={theme.onAccent} />
                <Text style={styles.mapsButtonText}>Перейти в Google Maps</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: SHEET_FRAME,
  card: {
    ...SHEET_WINDOW,
    backgroundColor: t.raised,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    padding: 20,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
  },
  date: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
    marginTop: -8,
  },
  carousel: {
    flexGrow: 0,
  },
  photoWrap: {
    width: 96,
    height: 96,
    borderRadius: 12,
    overflow: 'hidden',
    marginRight: 8,
    backgroundColor: t.field.fill,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAdd: {
    width: 96,
    height: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentInput: {
    backgroundColor: t.field.fill,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    minHeight: 64,
    maxHeight: 160,
    textAlignVertical: 'top',
  },
  mapsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.accent,
    borderRadius: 18,
    minHeight: 48,
    marginTop: 4,
  },
  mapsButtonText: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: t.onAccent,
  },
  pressed: {
    opacity: 0.7,
  },
});
