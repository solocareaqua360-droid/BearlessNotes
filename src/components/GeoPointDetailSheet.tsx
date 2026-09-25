import { useEffect, useState } from 'react';
import { Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import type { Block } from '../types';
import GlassLayer from './GlassLayer';
import AttachmentImage from './AttachmentImage';
import GeoThumbnail from './GeoThumbnail';
import GeoPointMapPicker from './GeoPointMapPicker';
import { FONT_BOLD, FONT_MONO, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { formatUpdatedAt } from '../utils/documentPreview';
import { formatDecimalLatLng, formatMgrs, type LatLng } from '../utils/geoCoordinates';

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
  geoLat?: number;
  geoLng?: number;
  // Whether the point has been through "Неточність" at least once - the
  // button's own label is what tells the two states apart (see
  // renderCorrectButton), so this needs no name of its own beyond that.
  geoCorrected?: boolean;
};

export default function GeoPointDetailSheet({
  link,
  onClose,
  onSaveComment,
  onAddPhoto,
  onRemovePhoto,
  onCorrectPosition,
}: {
  link: GeoDetailLink | null;
  onClose: () => void;
  onSaveComment: (comment: string) => void;
  onAddPhoto: () => void;
  onRemovePhoto: (attachmentId: string) => void;
  onCorrectPosition: (point: LatLng) => void;
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

  const [pickerVisible, setPickerVisible] = useState(false);

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

              {/* The card grew a map preview, two big copyable rows and a
                  correction button on top of what fit before - rather
                  than shrink any of that back down, the card scrolls.
                  bounces=false: a sheet that visibly rubber-bands past
                  its own last row reads as broken, not as "more below". */}
              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                bounces={false}
                showsVerticalScrollIndicator={false}
              >
              {!!(shown.createdAt ?? shown.updatedAt) && (
                <Text style={styles.date}>
                  Створено {formatUpdatedAt((shown.createdAt ?? shown.updatedAt) as number)}
                </Text>
              )}

              {shown.geoLat != null && shown.geoLng != null && (
                <>
                  <View style={styles.mapPreview}>
                    <GeoThumbnail lat={shown.geoLat} lng={shown.geoLng} width={400} height={140} style={styles.mapPreviewImage} />
                  </View>
                  <View style={styles.coordsBlock}>
                    <CoordRow
                      label="X, Y"
                      value={formatDecimalLatLng({ lat: shown.geoLat, lng: shown.geoLng })}
                      styles={styles}
                      theme={theme}
                    />
                    <CoordRow
                      label="MGRS"
                      value={formatMgrs({ lat: shown.geoLat, lng: shown.geoLng })}
                      styles={styles}
                      theme={theme}
                    />
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.correctButton, pressed && styles.pressed]}
                    onPress={() => setPickerVisible(true)}
                  >
                    <Ionicons
                      name={shown.geoCorrected ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                      size={16}
                      color={shown.geoCorrected ? theme.ink.muted : theme.accent}
                    />
                    <Text style={[styles.correctButtonText, { color: shown.geoCorrected ? theme.ink.muted : theme.accent }]}>
                      {shown.geoCorrected ? 'Відкоректовано' : 'Неточність'}
                    </Text>
                  </Pressable>
                </>
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
              </ScrollView>
            </>
          )}
        </View>
      </View>
      <GeoPointMapPicker
        visible={pickerVisible}
        initialPoint={shown && shown.geoLat != null && shown.geoLng != null ? { lat: shown.geoLat, lng: shown.geoLng } : null}
        onCancel={() => setPickerVisible(false)}
        onSave={(point) => {
          setPickerVisible(false);
          onCorrectPosition(point);
        }}
      />
    </GlassLayer>
  );
}

// One coordinate, in one of its two written-down languages - tap copies
// it, a small checkmark stands in for the copy icon for a moment as the
// only confirmation, since Android's own "Скопійовано" system toast
// already says the rest (Android 13+).
function CoordRow({
  label,
  value,
  styles,
  theme,
}: {
  label: string;
  value: string | null;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Pressable
      style={styles.coordsRow}
      disabled={!value}
      onPress={async () => {
        if (!value) return;
        await Clipboard.setStringAsync(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <Text style={styles.coordsLabel}>{label}</Text>
      <Text style={styles.coordsValue}>{value ?? '—'}</Text>
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={18}
        color={copied ? theme.accent : theme.ink.faint}
      />
    </Pressable>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: SHEET_FRAME,
  card: {
    ...SHEET_WINDOW,
    // A map preview, two big copyable coordinate rows and a correction
    // button on top of everything the card already held - it no longer
    // reliably fits the screen, so past this it scrolls (see `body`)
    // instead of running off the bottom.
    maxHeight: '88%',
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
  // flexShrink, not flex:1 - the card is only as tall as it needs to be
  // until it hits the card's own maxHeight, and only then does this
  // scroll (see ColorSchemeSheet's own identical body/bodyContent pair).
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    gap: 12,
    paddingBottom: 4,
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
  mapPreview: {
    height: 140,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: t.field.fill,
  },
  mapPreviewImage: {
    width: '100%',
    height: '100%',
  },
  coordsBlock: {
    gap: 8,
  },
  // A big, deliberate button, not a thin line of text with a small icon
  // at the end of it - the user's own report: reaching the copy icon
  // took real aim. The whole row is now the target, not just the icon.
  coordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: t.field.fill,
  },
  coordsLabel: {
    width: 48,
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.faint,
  },
  coordsValue: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_MONO,
    color: t.ink.primary,
  },
  correctButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    borderRadius: 12,
  },
  correctButtonText: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
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
