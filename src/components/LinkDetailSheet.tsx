import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import type { Block } from '../types';
import GlassLayer from './GlassLayer';
import AttachmentImage from './AttachmentImage';
import ZoomableImageViewer from './ZoomableImageViewer';
import GeoThumbnail from './GeoThumbnail';
import GeoPointMapPicker from './GeoPointMapPicker';
import { FONT_BOLD, FONT_MONO, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { formatUpdatedAt } from '../utils/documentPreview';
import { formatDecimalLatLng, formatMgrs, type LatLng } from '../utils/geoCoordinates';
import { hostnameOf } from '../utils/linkPreview';
import type { LinkCategory } from '../utils/linkCategory';
import type { LinkFragment } from '../utils/articleReader';
import { notify } from './surfaces/Ask';

// A link's own record - every link's, since 2026-09-25; it began as the
// geo point's alone. A tap on a link opens this; the site itself is one
// button inside (and a small icon on the list card, for a link that is
// just a link). A short note and photos belong to the link rather than to
// any one document that references it, the same two fields a Task
// carries. An ordinary page can also be saved for reading offline, and
// pieces marked while reading ("фрагменти") gather here before going on
// into a note.
export type DetailLink = {
  id: string;
  url: string;
  title?: string;
  imageUrl?: string;
  siteName?: string;
  category: LinkCategory;
  createdAt?: number;
  updatedAt?: number;
  comment?: string;
  attachments?: Block[];
  geoLat?: number;
  geoLng?: number;
  // Whether the point has been through "Неточність" at least once - the
  // button's own label is what tells the two states apart.
  geoCorrected?: boolean;
  articleSavedAt?: number;
  fragments?: LinkFragment[];
};

const PRIMARY: Record<LinkCategory, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  geo: { label: 'Перейти в Google Maps', icon: 'navigate-outline' },
  video: { label: 'Відтворити', icon: 'play-outline' },
  other: { label: 'Відкрити сторінку', icon: 'open-outline' },
};

export default function LinkDetailSheet({
  link,
  onClose,
  onOpen,
  onSaveComment,
  onAddPhoto,
  onRemovePhoto,
  onCorrectPosition,
  onSaveArticle,
  onRead,
  onDeleteArticle,
  onRemoveFragment,
  onFragmentsToNote,
}: {
  link: DetailLink | null;
  onClose: () => void;
  // The category's own way in: the page, the player, or Google Maps.
  onOpen: () => void;
  onSaveComment: (comment: string) => void;
  onAddPhoto: () => void;
  onRemovePhoto: (attachmentId: string) => void;
  onCorrectPosition: (point: LatLng) => void;
  onSaveArticle: () => Promise<void>;
  onRead: () => void;
  onDeleteArticle: () => void;
  onRemoveFragment: (fragment: LinkFragment) => void;
  onFragmentsToNote: (fragments: LinkFragment[]) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [comment, setComment] = useState(link?.comment ?? '');
  const [savingArticle, setSavingArticle] = useState(false);
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
    lastSavedComment.current = null;
  }, [link?.id, link?.comment]);

  // Looked at, or edited - the user's own rule, after a card that was
  // always both read as unfinished: delete crosses on every photo, a
  // cursor blinking in the comment. Looking shows the photos (a tap opens
  // them full screen) and the comment as plain text; "Редагувати" brings
  // the crosses, the "+", the comment field and the other changes, and
  // "Готово" saves and puts them away. It sits in the header, where the
  // keyboard cannot cover it - which is what hid the first "Зберегти".
  const [editing, setEditing] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  useEffect(() => {
    setEditing(false);
    setViewerIndex(null);
  }, [link?.id]);
  const lastSavedComment = useRef<string | null>(null);
  const commentDirty = comment.trim() !== (lastSavedComment.current ?? link?.comment ?? '');
  const [flash, setFlash] = useState<{ kind: 'photo' | 'comment'; text: string } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [flash]);

  function saveComment() {
    if (!commentDirty) return;
    lastSavedComment.current = comment.trim();
    onSaveComment(comment);
    setFlash({ kind: 'comment', text: 'Коментар збережено' });
  }

  function finishEditing() {
    saveComment();
    Keyboard.dismiss();
    setEditing(false);
  }

  // Closing mid-edit saves too - a card closed by its cross or by the
  // back button must not lose what was typed. With a photo open full
  // screen, back closes the photo first.
  function close() {
    if (viewerIndex !== null) {
      setViewerIndex(null);
      return;
    }
    saveComment();
    setEditing(false);
    onClose();
  }

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
  const fragments = [...(shown?.fragments ?? [])].sort((a, b) => a.createdAt - b.createdAt);
  const primary = PRIMARY[shown?.category ?? 'other'];

  // A photo that has just landed on this same card, not one of the
  // photos the card opened with.
  const photoCount = useRef<{ id?: string; count: number }>({ count: 0 });
  useEffect(() => {
    const previous = photoCount.current;
    if (previous.id === shown?.id && photos.length > previous.count) {
      setFlash({ kind: 'photo', text: 'Фото додано до картки' });
    }
    photoCount.current = { id: shown?.id, count: photos.length };
  }, [shown?.id, photos.length]);

  async function saveArticle() {
    setSavingArticle(true);
    try {
      await onSaveArticle();
    } catch (e) {
      notify('Не вдалося зберегти статтю', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingArticle(false);
    }
  }

  return (
    <GlassLayer visible={link !== null} onClose={close} intensity={60}>
      <View style={styles.frame} pointerEvents="box-none">
        <View style={[styles.card, { marginBottom: keyboardHeight }]}>
          {shown && (
            <>
              <View style={styles.header}>
                <Text style={styles.title} numberOfLines={2}>
                  {shown.title || (shown.category === 'geo' ? 'Геоточка' : hostnameOf(shown.url))}
                </Text>
                <Pressable
                  hitSlop={6}
                  onPress={editing ? finishEditing : () => setEditing(true)}
                  style={({ pressed }) => [editing ? styles.doneButton : styles.editButton, pressed && styles.pressed]}
                >
                  <Ionicons
                    name={editing ? 'checkmark' : 'create-outline'}
                    size={16}
                    color={editing ? theme.onAccent : theme.ink.primary}
                  />
                  <Text style={editing ? styles.doneButtonText : styles.editButtonText}>
                    {editing ? 'Готово' : 'Редагувати'}
                  </Text>
                </Pressable>
                <Pressable hitSlop={8} onPress={close}>
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
                  {shown.category !== 'geo' && `${shown.siteName || hostnameOf(shown.url)} · `}
                  Створено {formatUpdatedAt((shown.createdAt ?? shown.updatedAt) as number)}
                </Text>
              )}

              {shown.category !== 'geo' && !!shown.imageUrl && (
                <Image source={{ uri: shown.imageUrl }} style={styles.banner} resizeMode="cover" />
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
                  {editing && (
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
                  )}
                </>
              )}

              {(editing || photos.length > 0) && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carousel}>
                  {photos.map((photo, index) => (
                    <Pressable
                      key={photo.id}
                      style={styles.photoWrap}
                      disabled={editing}
                      onPress={() => setViewerIndex(index)}
                    >
                      <AttachmentImage
                        uri={photo.imageUri ?? ''}
                        driveFileId={photo.driveFileId}
                        style={styles.photo}
                        resizeMode="cover"
                      />
                      {editing && (
                        <Pressable style={styles.photoRemove} hitSlop={8} onPress={() => onRemovePhoto(photo.id)}>
                          <Ionicons name="close" size={13} color="#fff" />
                        </Pressable>
                      )}
                    </Pressable>
                  ))}
                  {editing && (
                    <Pressable style={styles.photoAdd} onPress={onAddPhoto}>
                      <Ionicons name="add" size={22} color={theme.accent} />
                    </Pressable>
                  )}
                </ScrollView>
              )}
              {flash?.kind === 'photo' && <SavedNote text={flash.text} styles={styles} theme={theme} />}

              {editing ? (
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Коментар"
                  placeholderTextColor={theme.ink.faint}
                  style={styles.commentInput}
                  multiline
                />
              ) : (
                !!comment.trim() && <Text style={styles.commentText}>{comment.trim()}</Text>
              )}
              {flash?.kind === 'comment' && <SavedNote text={flash.text} styles={styles} theme={theme} />}

              {/* Reading - an ordinary page only: a video or a map point
                  has no article to keep. */}
              {shown.category === 'other' &&
                (shown.articleSavedAt ? (
                  <View style={styles.articleRow}>
                    <Pressable style={({ pressed }) => [styles.readButton, pressed && styles.pressed]} onPress={onRead}>
                      <Ionicons name="book-outline" size={17} color={theme.accent} />
                      <Text style={styles.readButtonText}>Читати</Text>
                      <Text style={styles.articleSaved}>збережено {formatUpdatedAt(shown.articleSavedAt)}</Text>
                    </Pressable>
                    {editing && (
                    <Pressable hitSlop={8} onPress={onDeleteArticle} style={styles.articleDelete}>
                      <Ionicons name="trash-outline" size={17} color={theme.ink.faint} />
                    </Pressable>
                    )}
                  </View>
                ) : (
                  <Pressable
                    style={({ pressed }) => [styles.readButton, pressed && styles.pressed]}
                    onPress={saveArticle}
                    disabled={savingArticle}
                  >
                    {savingArticle ? (
                      <ActivityIndicator size="small" color={theme.accent} />
                    ) : (
                      <Ionicons name="download-outline" size={17} color={theme.accent} />
                    )}
                    <Text style={styles.readButtonText}>
                      {savingArticle ? 'Зберігаю статтю…' : 'Зберегти для читання'}
                    </Text>
                  </Pressable>
                ))}

              {fragments.length > 0 && (
                <View style={styles.fragments}>
                  <View style={styles.fragmentsHeader}>
                    <Text style={styles.fragmentsTitle}>Фрагменти · {fragments.length}</Text>
                    {fragments.length > 1 && (
                      <Pressable hitSlop={6} onPress={() => onFragmentsToNote(fragments)}>
                        <Text style={styles.fragmentsAll}>Усі в нотатку</Text>
                      </Pressable>
                    )}
                  </View>
                  {fragments.map((fragment) => (
                    <View key={fragment.id} style={styles.fragment}>
                      <Text style={styles.fragmentText} numberOfLines={6}>
                        {fragment.text}
                      </Text>
                      <View style={styles.fragmentActions}>
                        <Pressable hitSlop={8} onPress={() => onFragmentsToNote([fragment])}>
                          <Ionicons name="document-text-outline" size={18} color={theme.accent} />
                        </Pressable>
                        {editing && (
                        <Pressable hitSlop={8} onPress={() => onRemoveFragment(fragment)}>
                          <Ionicons name="close" size={18} color={theme.ink.faint} />
                        </Pressable>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <Pressable style={({ pressed }) => [styles.mapsButton, pressed && styles.pressed]} onPress={onOpen}>
                <Ionicons name={primary.icon} size={17} color={theme.onAccent} />
                <Text style={styles.mapsButtonText}>{primary.label}</Text>
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
      {viewerIndex !== null && photos[viewerIndex] && (
        <View style={styles.viewerLayer}>
          <ZoomableImageViewer
            uri={photos[viewerIndex].imageUri ?? ''}
            driveFileId={photos[viewerIndex].driveFileId}
            sketchElements={photos[viewerIndex].sketchElements}
            sketchWidth={photos[viewerIndex].sketchWidth}
            sketchHeight={photos[viewerIndex].sketchHeight}
            onClose={() => setViewerIndex(null)}
            onPrev={viewerIndex > 0 ? () => setViewerIndex(viewerIndex - 1) : undefined}
            onNext={viewerIndex < photos.length - 1 ? () => setViewerIndex(viewerIndex + 1) : undefined}
          />
        </View>
      )}
    </GlassLayer>
  );
}

// "Saved" said once, quietly, right under what was saved.
function SavedNote({ text, styles, theme }: { text: string; styles: ReturnType<typeof makeStyles>; theme: Theme }) {
  return (
    <View style={styles.savedNote}>
      <Ionicons name="checkmark-circle" size={15} color={theme.accent} />
      <Text style={styles.savedNoteText}>{text}</Text>
    </View>
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
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: t.field.fill,
  },
  editButtonText: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: t.accent,
  },
  doneButtonText: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.onAccent,
  },
  commentText: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  viewerLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 10,
  },
  savedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
  },
  savedNoteText: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  banner: {
    width: '100%',
    height: 150,
    borderRadius: 14,
    backgroundColor: t.field.fill,
  },
  articleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  readButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: t.field.fill,
  },
  readButtonText: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  articleSaved: {
    flex: 1,
    textAlign: 'right',
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
  },
  articleDelete: {
    width: 40,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fragments: {
    gap: 8,
  },
  fragmentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fragmentsTitle: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  fragmentsAll: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.accent,
  },
  fragment: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
    borderLeftWidth: 3,
    borderLeftColor: t.accent,
    borderRadius: 10,
    backgroundColor: t.field.fill,
  },
  fragmentText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  fragmentActions: {
    gap: 12,
    alignItems: 'center',
  },
});
