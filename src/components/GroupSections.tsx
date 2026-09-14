import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { Block, CustomDatabase, Tag } from '../types';
import { RootStackParamList } from '../navigation';
import DocumentCard from './DocumentCard';
import ZoomableImageViewer from './ZoomableImageViewer';
import { FileRow, LinkRow, PhotoCell, PhotoCardItem } from './ItemCards';
import { extractPreview } from '../utils/documentPreview';
import { openFileExternally } from '../utils/openFileExternally';
import { categoryFromSiteName } from '../utils/linkCategory';
import { colorForDocument } from '../utils/documentColor';
import { FONT_BOLD, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_LINE, GLASS_TEXT_MUTED } from '../constants/glass';

// What else is in this group. A group is the one thing in the app that
// deliberately crosses databases (see the Group comment in types.ts), and
// until now it only crossed them in the user's head: pick "mindEva" among
// the documents and the links on the same subject were two screens away.
//
// Under the list, one section per other database that has something in
// this group: a rule with the database's name and how many, then the same
// cards that database draws at home. Only ever with a real group chosen -
// on "Всі" this would just be the whole app in one endless column.

type Row = Record<string, unknown> & { id: string };

const ORDER = [
  'document',
  'link-geo',
  'link-other',
  'link-video',
  'photo',
  'file',
] as const;

const FACE: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  document: { label: 'Документи', icon: 'document-text-outline', color: '#3B82F6' },
  'link-geo': { label: 'Геоточки', icon: 'location-outline', color: '#16A34A' },
  'link-other': { label: 'Посилання', icon: 'link-outline', color: '#14B8A6' },
  'link-video': { label: 'YouTube / TikTok', icon: 'videocam-outline', color: '#EF4444' },
  photo: { label: 'Зображення', icon: 'image-outline', color: '#EC4899' },
  file: { label: 'Файли', icon: 'document-outline', color: '#8B5CF6' },
};

function useCollection(name: string, enabled: boolean): Row[] {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    // Nothing is listened to until a group is actually picked - these are
    // other databases' collections, and a screen that is showing "Всі" has
    // no business holding them open.
    if (!enabled) {
      setRows([]);
      return;
    }
    return onSnapshot(ownedQuery(name), (snapshot) => {
      setRows(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })));
    });
  }, [name, enabled]);
  return rows;
}

export default function GroupSections({
  groupId,
  currentKind,
  tags,
  sidePadding = 0,
  onOpen,
}: {
  // The group in view, or null when none is (everything below is skipped).
  groupId: string | null;
  // This screen's own database - it is already showing those, so its
  // section is left out.
  currentKind: string;
  tags: Tag[];
  // The side margin the calling list does NOT already provide. The
  // documents list has none of its own (its cards carry theirs), so it
  // passes 20; every other list already pads its own content.
  sidePadding?: number;
  // Called just before anything is opened - what a sheet uses to get out
  // of the way first, since it would otherwise stay standing over the
  // screen it just sent the user to.
  onOpen?: () => void;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const enabled = !!groupId;
  // Every open goes through here, so the sheet above gets its chance to
  // close before the screen underneath changes.
  const open = (go: () => void) => {
    onOpen?.();
    go();
  };
  const documents = useCollection('documents', enabled);
  const links = useCollection('links', enabled);
  const photos = useCollection('photos', enabled);
  const files = useCollection('files', enabled);
  const customRows = useCollection('customDatabaseRows', enabled);
  const customDatabases = useCollection('customDatabases', enabled);
  const [viewerPhoto, setViewerPhoto] = useState<string | null>(null);

  if (!groupId) return null;

  const inGroup = (rows: Row[]) => rows.filter((r) => r.groupId === groupId);
  const tagsFor = (row: Row) => {
    const ids = (row.tagIds as string[] | undefined) ?? [];
    return tags.filter((t) => ids.includes(t.id));
  };

  const byKind: Record<string, Row[]> = {
    document: inGroup(documents).filter((d) => !d.calendarDate),
    photo: inGroup(photos),
    file: inGroup(files),
    'link-geo': [],
    'link-other': [],
    'link-video': [],
  };
  for (const link of inGroup(links)) {
    byKind[`link-${categoryFromSiteName(link.siteName as string | undefined)}`].push(link);
  }

  // Every custom database is a section of its own, named and coloured as
  // its tile is - a row's own database decides what it is called.
  const customSections = customDatabases
    .map((database) => {
      const rows = inGroup(customRows).filter((r) => r.databaseId === database.id);
      return { database: database as unknown as CustomDatabase, rows };
    })
    .filter(({ database, rows }) => rows.length > 0 && `customRow:${database.id}` !== currentKind);

  const sections = ORDER.filter((kind) => kind !== currentKind && byKind[kind].length > 0);
  if (sections.length === 0 && customSections.length === 0) return null;

  function Divider({ label, icon, color, count }: { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; count: number }) {
    return (
      <View style={styles.divider}>
        <View style={styles.dividerRule} />
        <Ionicons name={icon} size={14} color={color} />
        <Text style={[styles.dividerLabel, { color }]}>{label}</Text>
        <Text style={styles.dividerCount}>{count}</Text>
        <View style={styles.dividerRule} />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { paddingHorizontal: sidePadding }]}>
      {sections.map((kind) => {
        const face = FACE[kind];
        const rows = byKind[kind];
        return (
          <View key={kind} style={styles.section}>
            <Divider label={face.label} icon={face.icon} color={face.color} count={rows.length} />
            {kind === 'photo' ? (
              <View style={styles.photoGrid}>
                {rows.map((row) => {
                  const photo: PhotoCardItem = {
                    id: row.id,
                    imageUri: row.imageUri as string,
                    driveFileId: row.driveFileId as string | undefined,
                    documentIds: Object.keys((row.usedInDocuments as Record<string, true>) ?? {}),
                    tagIds: (row.tagIds as string[] | undefined) ?? [],
                  };
                  return (
                    <PhotoCell
                      key={row.id}
                      photo={photo}
                      tags={tagsFor(row)}
                      onPress={() => open(() => setViewerPhoto(photo.imageUri))}
                    />
                  );
                })}
              </View>
            ) : (
              <View style={styles.column}>
                {rows.map((row) => {
                  if (kind === 'document') {
                    const { imageUri, imageUris, previewText, checklistItems } = extractPreview(
                      row.blocks as Block[] | undefined,
                      row.coverImageUri as string | undefined
                    );
                    return (
                      <DocumentCard
                        key={row.id}
                        id={row.id}
                        title={row.title as string}
                        updatedAt={(row.updatedAt as number) ?? 0}
                        imageUri={imageUri}
                        imageUris={imageUris}
                        previewText={previewText}
                        checklistItems={checklistItems}
                        flush
                        onPress={() => open(() => navigation.navigate('Editor', { documentId: row.id }))}
                      />
                    );
                  }
                  if (kind === 'file') {
                    return (
                      <FileRow
                        key={row.id}
                        file={{
                          id: row.id,
                          fileName: row.fileName as string,
                          title: row.title as string | undefined,
                          tagIds: (row.tagIds as string[] | undefined) ?? [],
                        }}
                        tags={tagsFor(row)}
                        onPress={() =>
                          open(() => openFileExternally({
                            fileUri: row.fileUri as string,
                            fileName: row.fileName as string,
                            mimeType: row.mimeType as string | undefined,
                            driveFileId: row.driveFileId as string | undefined,
                          }))
                        }
                      />
                    );
                  }
                  return (
                    <LinkRow
                      key={row.id}
                      link={{
                        id: row.id,
                        url: row.url as string,
                        title: row.title as string | undefined,
                        siteName: row.siteName as string | undefined,
                        imageUrl: row.imageUrl as string | undefined,
                        tagIds: (row.tagIds as string[] | undefined) ?? [],
                      }}
                      tags={tagsFor(row)}
                      onPress={() => open(() => Linking.openURL(row.url as string).catch(() => {}))}
                    />
                  );
                })}
              </View>
            )}
          </View>
        );
      })}

      {customSections.map(({ database, rows }) => (
        <View key={database.id} style={styles.section}>
          <Divider
            label={database.name}
            icon={(database.icon as keyof typeof Ionicons.glyphMap) ?? 'grid-outline'}
            color={database.color ?? '#F97316'}
            count={rows.length}
          />
          <View style={styles.column}>
            {rows.map((row) => {
              const values = (row.values as Record<string, unknown>) ?? {};
              const first = database.fields?.find((f) => typeof values[f.id] === 'string');
              const title = first ? (values[first.id] as string) : 'Без назви';
              const { background, text } = colorForDocument(row.id);
              return (
                <Pressable
                  key={row.id}
                  style={[styles.recordRow, { backgroundColor: background }]}
                  onPress={() =>
                    open(() =>
                      navigation.navigate('CustomDatabase', { databaseId: database.id, openRowId: row.id })
                    )
                  }
                >
                  <Ionicons
                    name={(database.icon as keyof typeof Ionicons.glyphMap) ?? 'grid-outline'}
                    size={18}
                    color={database.color ?? '#F97316'}
                  />
                  <Text style={[styles.recordLabel, { color: text }]} numberOfLines={1}>
                    {title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      {viewerPhoto && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setViewerPhoto(null)}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ZoomableImageViewer uri={viewerPhoto} onClose={() => setViewerPhoto(null)} />
          </GestureHandlerRootView>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Full width on purpose: these sit at the end of a list that may be a
  // wrapping grid, and a full-width block is also what forces the break.
  wrap: {
    width: '100%',
  },
  section: {
    width: '100%',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    marginBottom: 10,
  },
  dividerRule: {
    flex: 1,
    height: 1,
    backgroundColor: GLASS_LINE,
  },
  dividerLabel: {
    fontSize: 12,
    fontFamily: FONT_BOLD,
    letterSpacing: 0.06,
    textTransform: 'uppercase',
  },
  dividerCount: {
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
  column: {
    gap: 10,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  recordLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
  },
});
