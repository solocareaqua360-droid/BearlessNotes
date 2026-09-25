import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import type { Block } from '../types';
import GlassLayer from './GlassLayer';
import Sheet from './surfaces/Sheet';
import AttachmentImage from './AttachmentImage';
import ZoomableImageViewer from './ZoomableImageViewer';
import GeoThumbnail from './GeoThumbnail';
import GeoPointMapPicker from './GeoPointMapPicker';
import { FONT_BOLD, FONT_MONO, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { formatUpdatedAt } from '../utils/documentPreview';
import { formatDecimalLatLng, formatMgrs, type LatLng } from '../utils/geoCoordinates';
import { hostnameOf } from '../utils/linkPreview';
import type { LinkCategory } from '../utils/linkCategory';
import type { LinkFragment } from '../utils/articleReader';
import { notify } from './surfaces/Ask';

// A link's own record - every link's, since 2026-09-25; it began as the
// geo point's alone. A tap on a link opens this; the site itself is a
// button inside (and a small icon on the list card, for a link that is
// just a link). A short note and photos belong to the link rather than to
// any one document that references it, the same two fields a Task
// carries. An ordinary page can also be saved for reading offline, and
// pieces marked while reading ("фрагменти") gather here before going on
// into a note.
//
// BUILT AS BLOCKS, each in its own framed panel with a heading - the
// user's verdict on the first version: everything worked, but it ran
// together (where does the link's preview end and the photos begin?),
// and its actions were small icons in corners. The card scrolls anyway,
// so nothing on it is made small to fit: every action is a full-size
// button with its own edge, an icon and a word.
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
  // the sheet's `visible` to false - content would otherwise blank out a
  // beat before the card has even started fading, which reads as a
  // flash. This keeps the last real link on screen through that.
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
  // the crosses, "Додати фото", the comment field and the other changes,
  // and "Готово" saves and puts them away. Both sit in the sheet's fixed
  // header, where the keyboard cannot cover them.
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

  // Closing mid-edit saves too - a card closed by its cross, a tap
  // outside or the back button must not lose what was typed.
  function close() {
    saveComment();
    setEditing(false);
    onClose();
  }

  const [pickerVisible, setPickerVisible] = useState(false);

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

  const header = shown ? (
    <View style={styles.header}>
      <Text style={styles.title} numberOfLines={2}>
        {shown.title || (shown.category === 'geo' ? 'Геоточка' : hostnameOf(shown.url))}
      </Text>
      <Pressable
        onPress={editing ? finishEditing : () => setEditing(true)}
        style={({ pressed }) => [editing ? styles.doneButton : styles.editButton, pressed && styles.pressed]}
      >
        <Ionicons name={editing ? 'checkmark' : 'create-outline'} size={18} color={editing ? theme.onAccent : theme.ink.primary} />
        <Text style={editing ? styles.doneButtonText : styles.editButtonText}>{editing ? 'Готово' : 'Редагувати'}</Text>
      </Pressable>
      <Pressable onPress={close} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
        <Ionicons name="close" size={22} color={theme.ink.primary} />
      </Pressable>
    </View>
  ) : null;

  return (
    <>
      <Sheet visible={link !== null} onClose={close} header={header} scroll maxHeight="78%">
        {shown && (
          <View style={styles.body}>
            {!!(shown.createdAt ?? shown.updatedAt) && (
              <Text style={styles.meta}>
                {shown.category !== 'geo' && `${shown.siteName || hostnameOf(shown.url)} · `}
                Створено {formatUpdatedAt((shown.createdAt ?? shown.updatedAt) as number)}
              </Text>
            )}

            {/* The link itself - its picture and the way out, together. */}
            {shown.category === 'geo' ? (
              <Panel icon="location-outline" title="Місце" styles={styles} theme={theme}>
                {shown.geoLat != null && shown.geoLng != null && (
                  <>
                    <View style={styles.mapPreview}>
                      <GeoThumbnail lat={shown.geoLat} lng={shown.geoLng} width={400} height={160} style={styles.fill} />
                    </View>
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
                    {editing && (
                      <Button
                        icon={shown.geoCorrected ? 'checkmark-circle-outline' : 'locate-outline'}
                        label={shown.geoCorrected ? 'Відкоректовано - змінити ще раз' : 'Неточність - вказати на мапі'}
                        onPress={() => setPickerVisible(true)}
                        styles={styles}
                        theme={theme}
                      />
                    )}
                  </>
                )}
                <Button icon={primary.icon} label={primary.label} onPress={onOpen} kind="primary" styles={styles} theme={theme} />
              </Panel>
            ) : (
              <Panel
                icon={shown.category === 'video' ? 'play-circle-outline' : 'link-outline'}
                title={shown.category === 'video' ? 'Відео' : 'Посилання'}
                styles={styles}
                theme={theme}
              >
                {!!shown.imageUrl && <Image source={{ uri: shown.imageUrl }} style={styles.banner} resizeMode="cover" />}
                <Text style={styles.url} numberOfLines={2}>
                  {shown.url}
                </Text>
                <Button icon={primary.icon} label={primary.label} onPress={onOpen} kind="primary" styles={styles} theme={theme} />
              </Panel>
            )}

            {(editing || photos.length > 0) && (
              <Panel icon="images-outline" title="Фото" count={photos.length} styles={styles} theme={theme}>
                {photos.length > 0 && (
                  <View style={styles.photoGrid}>
                    {photos.map((photo, index) => (
                      <Pressable
                        key={photo.id}
                        style={styles.photoCell}
                        disabled={editing}
                        onPress={() => setViewerIndex(index)}
                      >
                        <AttachmentImage
                          uri={photo.imageUri ?? ''}
                          driveFileId={photo.driveFileId}
                          style={styles.fill}
                          resizeMode="cover"
                        />
                        {editing && (
                          <Pressable
                            style={({ pressed }) => [styles.photoRemove, pressed && styles.pressed]}
                            hitSlop={6}
                            onPress={() => onRemovePhoto(photo.id)}
                          >
                            <Ionicons name="close" size={18} color="#fff" />
                          </Pressable>
                        )}
                      </Pressable>
                    ))}
                  </View>
                )}
                {editing && <Button icon="add" label="Додати фото" onPress={onAddPhoto} styles={styles} theme={theme} />}
                {flash?.kind === 'photo' && <SavedNote text={flash.text} styles={styles} theme={theme} />}
              </Panel>
            )}

            {(editing || !!comment.trim()) && (
              <Panel icon="chatbox-ellipses-outline" title="Коментар" styles={styles} theme={theme}>
                {editing ? (
                  <TextInput
                    value={comment}
                    onChangeText={setComment}
                    placeholder="Що про це варто пам'ятати"
                    placeholderTextColor={theme.ink.faint}
                    style={styles.commentInput}
                    multiline
                  />
                ) : (
                  <Text style={styles.commentText}>{comment.trim()}</Text>
                )}
                {flash?.kind === 'comment' && <SavedNote text={flash.text} styles={styles} theme={theme} />}
              </Panel>
            )}

            {/* Reading - an ordinary page only: a video or a map point
                has no article to keep. */}
            {shown.category === 'other' && (
              <Panel icon="book-outline" title="Стаття" styles={styles} theme={theme}>
                {shown.articleSavedAt ? (
                  <>
                    <Text style={styles.panelNote}>
                      Збережено {formatUpdatedAt(shown.articleSavedAt)} - читається без інтернету
                    </Text>
                    <Button icon="book-outline" label="Читати" onPress={onRead} styles={styles} theme={theme} />
                    {editing && (
                      <Button
                        icon="trash-outline"
                        label="Прибрати збережену статтю"
                        onPress={onDeleteArticle}
                        kind="danger"
                        styles={styles}
                        theme={theme}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.panelNote}>Збереже текст статті, щоб читати й виділяти фрагменти без інтернету</Text>
                    <Button
                      icon="download-outline"
                      label={savingArticle ? 'Зберігаю статтю…' : 'Зберегти для читання'}
                      onPress={saveArticle}
                      busy={savingArticle}
                      styles={styles}
                      theme={theme}
                    />
                  </>
                )}
              </Panel>
            )}

            {fragments.length > 0 && (
              <Panel icon="bookmark-outline" title="Фрагменти" count={fragments.length} styles={styles} theme={theme}>
                {fragments.map((fragment) => (
                  <View key={fragment.id} style={styles.fragment}>
                    <Text style={styles.fragmentText} numberOfLines={8}>
                      {fragment.text}
                    </Text>
                    <View style={styles.fragmentActions}>
                      <Button
                        icon="document-text-outline"
                        label="У нотатку"
                        onPress={() => onFragmentsToNote([fragment])}
                        compact
                        styles={styles}
                        theme={theme}
                      />
                      {editing && (
                        <Button
                          icon="trash-outline"
                          label="Видалити"
                          onPress={() => onRemoveFragment(fragment)}
                          kind="danger"
                          compact
                          styles={styles}
                          theme={theme}
                        />
                      )}
                    </View>
                  </View>
                ))}
                {fragments.length > 1 && (
                  <Button
                    icon="documents-outline"
                    label={`Усі ${fragments.length} у нотатку`}
                    onPress={() => onFragmentsToNote(fragments)}
                    styles={styles}
                    theme={theme}
                  />
                )}
              </Panel>
            )}
          </View>
        )}
      </Sheet>

      <GeoPointMapPicker
        visible={pickerVisible}
        initialPoint={shown && shown.geoLat != null && shown.geoLng != null ? { lat: shown.geoLat, lng: shown.geoLng } : null}
        onCancel={() => setPickerVisible(false)}
        onSave={(point) => {
          setPickerVisible(false);
          onCorrectPosition(point);
        }}
      />

      {/* Its own layer over the card, so back closes the photo first. */}
      <GlassLayer visible={viewerIndex !== null && !!photos[viewerIndex]} onClose={() => setViewerIndex(null)}>
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
    </>
  );
}

type Styles = ReturnType<typeof makeStyles>;

// One block of the card: its own framed panel, an icon and a heading, so
// where one part ends and the next begins is never a guess.
function Panel({
  icon,
  title,
  count,
  children,
  styles,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  count?: number;
  children: ReactNode;
  styles: Styles;
  theme: Theme;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Ionicons name={icon} size={18} color={theme.accent} />
        <Text style={styles.panelTitle}>{title}</Text>
        {!!count && <Text style={styles.panelCount}>{count}</Text>}
      </View>
      {children}
    </View>
  );
}

// A full-size action: its own edge, an icon and a word - never a lone
// glyph in a corner. `primary` is the card's one way out; `danger` only
// ever appears while editing.
function Button({
  icon,
  label,
  onPress,
  kind = 'secondary',
  compact,
  busy,
  styles,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  compact?: boolean;
  busy?: boolean;
  styles: Styles;
  theme: Theme;
}) {
  const ink = kind === 'primary' ? theme.onAccent : kind === 'danger' ? theme.danger : theme.ink.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.button,
        kind === 'primary' && styles.buttonPrimary,
        kind === 'danger' && styles.buttonDanger,
        compact && styles.buttonCompact,
        pressed && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={ink} /> : <Ionicons name={icon} size={20} color={ink} />}
      <Text style={[styles.buttonLabel, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

// "Saved" said once, quietly, right under what was saved.
function SavedNote({ text, styles, theme }: { text: string; styles: Styles; theme: Theme }) {
  return (
    <View style={styles.savedNote}>
      <Ionicons name="checkmark-circle" size={16} color={theme.accent} />
      <Text style={styles.savedNoteText}>{text}</Text>
    </View>
  );
}

// One coordinate, in one of its two written-down languages - the whole
// row copies it (the user's own report: reaching a small copy icon took
// real aim), a checkmark standing in for the icon for a moment as the
// only confirmation, since Android's own "Скопійовано" toast says the
// rest (Android 13+).
function CoordRow({
  label,
  value,
  styles,
  theme,
}: {
  label: string;
  value: string | null;
  styles: Styles;
  theme: Theme;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Pressable
      style={({ pressed }) => [styles.coordsRow, pressed && styles.pressed]}
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
      <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color={copied ? theme.accent : theme.ink.muted} />
    </Pressable>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 14,
    },
    title: {
      flex: 1,
      fontSize: 20,
      fontFamily: FONT_BOLD,
      color: t.ink.primary,
    },
    editButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 44,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.edge.strong,
      backgroundColor: t.field.fill,
    },
    editButtonText: {
      fontSize: 15,
      fontFamily: FONT_SEMIBOLD,
      color: t.ink.primary,
    },
    doneButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 44,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: t.accent,
    },
    doneButtonText: {
      fontSize: 15,
      fontFamily: FONT_SEMIBOLD,
      color: t.onAccent,
    },
    closeButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: t.edge.strong,
      backgroundColor: t.field.fill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: {
      gap: 14,
    },
    meta: {
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: t.ink.muted,
    },
    panel: {
      gap: 12,
      padding: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: t.edge.hairline,
      backgroundColor: t.field.fill,
    },
    panelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    panelTitle: {
      fontSize: 15,
      fontFamily: FONT_SEMIBOLD,
      color: t.ink.primary,
    },
    panelCount: {
      fontSize: 13,
      fontFamily: FONT_SEMIBOLD,
      color: t.ink.muted,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: t.raised,
    },
    panelNote: {
      fontSize: 13,
      lineHeight: 18,
      fontFamily: FONT_REGULAR,
      color: t.ink.muted,
    },
    fill: {
      width: '100%',
      height: '100%',
    },
    banner: {
      width: '100%',
      height: 170,
      borderRadius: 14,
      backgroundColor: t.raised,
    },
    url: {
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: t.ink.muted,
    },
    mapPreview: {
      height: 160,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: t.raised,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 50,
      paddingHorizontal: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.edge.strong,
      backgroundColor: t.raised,
    },
    buttonPrimary: {
      backgroundColor: t.accent,
      borderColor: t.accent,
    },
    buttonDanger: {
      borderColor: t.danger,
    },
    buttonCompact: {
      minHeight: 44,
      flex: 1,
    },
    buttonLabel: {
      fontSize: 15,
      fontFamily: FONT_SEMIBOLD,
    },
    photoGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    // flexBasis + aspectRatio, never a measured width - see the memory
    // measured_width_deformation.
    photoCell: {
      flexBasis: '31%',
      flexGrow: 0,
      aspectRatio: 1,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: t.raised,
    },
    photoRemove: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.65)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    commentInput: {
      backgroundColor: t.raised,
      borderWidth: 1,
      borderColor: t.edge.strong,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      fontFamily: FONT_REGULAR,
      color: t.ink.primary,
      minHeight: 110,
      textAlignVertical: 'top',
    },
    commentText: {
      fontSize: 16,
      lineHeight: 23,
      fontFamily: FONT_REGULAR,
      color: t.ink.primary,
    },
    fragment: {
      gap: 10,
      padding: 12,
      borderRadius: 14,
      borderLeftWidth: 4,
      borderLeftColor: t.accent,
      backgroundColor: t.raised,
    },
    fragmentText: {
      fontSize: 15,
      lineHeight: 22,
      fontFamily: FONT_REGULAR,
      color: t.ink.primary,
    },
    fragmentActions: {
      flexDirection: 'row',
      gap: 8,
    },
    coordsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 54,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.edge.hairline,
      backgroundColor: t.raised,
    },
    coordsLabel: {
      width: 52,
      fontSize: 13,
      fontFamily: FONT_SEMIBOLD,
      color: t.ink.muted,
    },
    coordsValue: {
      flex: 1,
      fontSize: 15,
      fontFamily: FONT_MONO,
      color: t.ink.primary,
    },
    savedNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    savedNoteText: {
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: t.ink.muted,
    },
    viewerLayer: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
    pressed: {
      opacity: 0.7,
    },
  });
