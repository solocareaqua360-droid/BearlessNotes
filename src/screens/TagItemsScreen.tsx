import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  collection,
  doc,
  getDoc,
} from '../firestore';
import { addDoc } from '../utils/owned';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { TaggableKind } from '../types';
import { useTags, itemsCollectionForKind, parseUsedInKey } from '../hooks/useTags';
import ContentColumn from '../components/ContentColumn';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { SectionKey, Theme } from '../theme/tokens';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

const documentsCollection = collection(db, 'documents');

// Which section each kind of row belongs to - so a row here takes
// exactly the colour its own screen would give it, rather than an
// independent literal nobody kept in step (this used to be violet for
// "file" while Files itself was blue). The three link kinds share one
// colour: LinksScreen itself draws no distinction between them either.
const KIND_SECTION: Record<string, { icon: keyof typeof Ionicons.glyphMap; section: SectionKey }> = {
  file: { icon: 'document-outline', section: 'files' },
  photo: { icon: 'image-outline', section: 'photos' },
  'link-video': { icon: 'videocam-outline', section: 'links' },
  'link-geo': { icon: 'location-outline', section: 'links' },
  'link-other': { icon: 'link-outline', section: 'links' },
  document: { icon: 'document-text-outline', section: 'documents' },
};
// Every custom database shares this one fallback (KIND_SECTION has no
// entry per database id) - good enough here since this screen only
// needs an icon/colour to draw a row, not the database's own identity.
const CUSTOM_ROW_ICON = { icon: 'grid-outline' as const, section: 'custom' as SectionKey };

type ResolvedItem = {
  key: string;
  kind: TaggableKind;
  itemId: string;
  title: string;
};

type Props = NativeStackScreenProps<RootStackParamList, 'TagItems'>;

// Bear-style "open a tag, see everything on it, create something new right
// there" - reached from Search's tree or tile view. The "+" only offers a
// new Document: files/photos/links have no standalone creation screen
// anywhere in the app (they're only ever created by attaching a block
// inside some document), so a document pre-tagged with this tag - opened
// straight into the editor - is the one kind this can honestly offer.
export default function TagItemsScreen({ route }: Props) {
  const { tagId } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const { tags, attachTag } = useTags();
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const tag = tags.find((t) => t.id === tagId);

  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const resolved = await Promise.all(
        Object.keys(tag.usedIn).map(async (key): Promise<ResolvedItem | null> => {
          const { kind, itemId } = parseUsedInKey(key);
          const itemsCollection = itemsCollectionForKind(kind);
          if (!itemsCollection) return null;
          const snapshot = await getDoc(doc(db, itemsCollection, itemId));
          const data = snapshot.data();
          if (!data) return null;
          // A custom-database row has no title/fileName/url field of its
          // own - its display name is whichever value sits in fields[0],
          // and this screen doesn't have that database's field schema
          // loaded. The first entry in `values` is close enough for a row
          // in a list here (fields[0] is normally inserted first).
          const title = data.title || data.fileName || data.url || Object.values(data.values ?? {})[0] || 'Без назви';
          return { key, kind, itemId, title };
        })
      );
      if (!cancelled) {
        setItems(resolved.filter((r): r is ResolvedItem => r !== null));
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // tag.usedIn is a plain object - re-run whenever the tag doc (and thus
    // the set of usages) changes, not on every unrelated tags-list update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag?.id, tag ? Object.keys(tag.usedIn).join(',') : '']);

  function openItem(item: ResolvedItem) {
    if (item.kind === 'document') {
      navigation.navigate('Editor', { documentId: item.itemId });
    } else if (item.kind === 'file') {
      navigation.navigate('Files');
    } else if (item.kind === 'photo') {
      navigation.navigate('Photos');
    } else {
      const category = item.kind === 'link-video' ? 'video' : item.kind === 'link-geo' ? 'geo' : 'other';
      navigation.navigate('Links', { category });
    }
  }

  async function createTaggedDocument() {
    if (!tag) return;
    const now = Date.now();
    const newDoc = await addDoc(documentsCollection, { title: 'Без назви', createdAt: now, updatedAt: now, blocks: [] });
    await attachTag(tag, 'document', newDoc.id, 'documents');
    navigation.navigate('Editor', { documentId: newDoc.id, autoFocusTitle: true });
  }

  if (!tag) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <Text style={styles.emptyLabel}>Цей тег більше не існує</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ContentColumn>
        <View style={styles.headerRow}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={22} color={theme.ink.primary} />
          </Pressable>
          <View style={[styles.headerIcon, { backgroundColor: `${tag.color}1F` }]}>
            <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={17} color={tag.color} />
          </View>
          <Text style={styles.headerTitle}>{tag.path}</Text>
        </View>
        <Text style={styles.subtitle}>
          {items.length} {items.length === 1 ? 'елемент' : 'елементів'}
        </Text>

        {isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={tag.color} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {items.map((item) => {
              const info = KIND_SECTION[item.kind] ?? CUSTOM_ROW_ICON;
              const color = theme.sections[info.section];
              return (
                <Pressable key={item.key} style={styles.row} onPress={() => openItem(item)}>
                  <View style={[styles.rowIcon, { backgroundColor: `${color}1A` }]}>
                    <Ionicons name={info.icon} size={17} color={color} />
                  </View>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {item.title}
                  </Text>
                </Pressable>
              );
            })}

            <Pressable style={styles.createRow} onPress={createTaggedDocument}>
              <Ionicons name="add" size={18} color={theme.sections.documents} />
              <Text style={styles.createLabel}>Створити новий документ з тегом "{tag.path}"</Text>
            </Pressable>
          </ScrollView>
        )}
      </ContentColumn>

    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.ground,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 56,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
    flexShrink: 1,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
    paddingLeft: 68,
    paddingTop: 4,
    paddingBottom: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.surface,
    borderRadius: 14,
    padding: 10,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  createRow: {
    marginTop: 6,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.edge.strong,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  createLabel: {
    fontSize: 14,
    color: t.sections.documents,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
});
