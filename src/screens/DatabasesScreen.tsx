import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { TAG_COLORS } from '../constants/tags';
import { FONT_REGULAR, FONT_MEDIUM, FONT_BOLD } from '../utils/fonts';

type Tile = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  // Set only for the three tiles backed by the one `links` mirror collection
  // (see DocumentEditorScreen's fetchLinkPreview / LinksScreen's categoryOf) -
  // each opens the same screen pre-filtered to its own slice instead of a
  // "Скоро" placeholder.
  linkCategory?: 'video' | 'geo' | 'other';
  // Set for tiles with their own dedicated (paramless) screen.
  route?: 'Photos' | 'Files' | 'Tags' | 'Diary';
};

// "Справи", the link-backed tiles, "Фото" and "Файли" are real, working
// databases so far (see TasksScreen/LinksScreen/PhotosScreen/FilesScreen) -
// only "нагадування" from PROJECT_BRIEF.md's default-types list is still a
// placeholder, filled in the same way each of the above went from "just a
// block" to a real cross-document list. Colors used to be hardcoded per
// tile here - they're user-editable now (see tileColors below), so this
// list only carries what's NOT a matter of preference: which screen a tile
// opens.
const WIDE_TILE_KEY = 'tasks';
const GRID_TILES: Tile[] = [
  { key: 'geo', label: 'Геоточки', icon: 'location-outline', linkCategory: 'geo' },
  { key: 'links', label: 'Посилання', icon: 'link-outline', linkCategory: 'other' },
  { key: 'photos', label: 'Фото', icon: 'image-outline', route: 'Photos' },
  { key: 'video', label: 'YouTube / TikTok', icon: 'videocam-outline', linkCategory: 'video' },
  { key: 'files', label: 'Файли', icon: 'document-outline', route: 'Files' },
  { key: 'tags', label: 'Теги', icon: 'pricetag-outline', route: 'Tags' },
  { key: 'diary', label: 'Щоденник', icon: 'book-outline', route: 'Diary' },
];

const tileColorsDoc = doc(db, 'settings', 'databaseTileColors');

// Deterministic starting color per tile (harmonious palette, cycled by
// position) - only used until the user picks their own via the tile's
// "..." menu, at which point Firestore's own value takes over.
function defaultColorFor(key: string): string {
  const allKeys = [WIDE_TILE_KEY, ...GRID_TILES.map((t) => t.key)];
  const index = allKeys.indexOf(key);
  return TAG_COLORS[index % TAG_COLORS.length];
}

export default function DatabasesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [tileColors, setTileColors] = useState<Record<string, string>>({});
  const [colorMenuKey, setColorMenuKey] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(tileColorsDoc, (snapshot) => {
      setTileColors((snapshot.data() as Record<string, string> | undefined) ?? {});
    });
  }, []);

  function colorFor(key: string): string {
    return tileColors[key] ?? defaultColorFor(key);
  }

  function pickColor(key: string, color: string) {
    setDoc(tileColorsDoc, { [key]: color }, { merge: true });
    setColorMenuKey(null);
  }

  function openTile(tile: Tile) {
    if (tile.linkCategory) {
      navigation.navigate('Links', { category: tile.linkCategory });
    } else if (tile.route) {
      navigation.navigate(tile.route);
    } else {
      navigation.navigate('Placeholder', { icon: tile.icon, label: 'Скоро' });
    }
  }

  return (
    <View style={styles.container}>
      {/* Same fixed gradient as Documents/Calendar. */}
      <Svg width={windowWidth} height={windowHeight} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="databasesBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth} height={windowHeight} fill="url(#databasesBg)" />
      </Svg>

      <View style={styles.headerRow}>
        <Text style={styles.header}>Бази даних</Text>
        <View style={styles.headerButtons}>
          <Pressable hitSlop={6} onPress={() => navigation.navigate('Search')}>
            <Ionicons name="search" size={17} color="#fff" />
          </Pressable>
          <View style={styles.headerButtonsDivider} />
          <Pressable hitSlop={6} onPress={() => navigation.navigate('Settings')}>
            <Ionicons name="ellipsis-horizontal" size={17} color="#fff" />
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.wideTile} onPress={() => navigation.navigate('Tasks')}>
          <Ionicons name="checkbox-outline" size={22} color={colorFor(WIDE_TILE_KEY)} />
          <Text style={[styles.tileLabel, { color: colorFor(WIDE_TILE_KEY) }]}>Справи</Text>
          <Pressable
            hitSlop={8}
            style={styles.tileMenuButton}
            onPress={(e) => {
              e.stopPropagation();
              setColorMenuKey(WIDE_TILE_KEY);
            }}
          >
            <Ionicons name="ellipsis-horizontal" size={16} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </Pressable>

        <View style={styles.grid}>
          {GRID_TILES.map((tile) => (
            <Pressable key={tile.key} style={styles.tile} onPress={() => openTile(tile)}>
              <Ionicons name={tile.icon} size={22} color={colorFor(tile.key)} />
              <Text style={[styles.tileLabel, { color: colorFor(tile.key) }]}>{tile.label}</Text>
              <Pressable
                hitSlop={8}
                style={styles.tileMenuButton}
                onPress={(e) => {
                  e.stopPropagation();
                  setColorMenuKey(tile.key);
                }}
              >
                <Ionicons name="ellipsis-horizontal" size={16} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </Pressable>
          ))}

          <Pressable
            style={[styles.tile, styles.newTile]}
            onPress={() => navigation.navigate('Placeholder', { icon: 'add-outline', label: 'Скоро' })}
          >
            <Ionicons name="add" size={22} color="rgba(255,255,255,0.6)" />
            <Text style={styles.newTileLabel}>Нова база</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Color picker - only the harmonious palette is offered. */}
      <Modal visible={colorMenuKey !== null} transparent animationType="fade" onRequestClose={() => setColorMenuKey(null)}>
        <Pressable style={styles.colorMenuBackdrop} onPress={() => setColorMenuKey(null)}>
          <Pressable style={styles.colorMenuCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.colorMenuTitle}>Колір плитки</Text>
            <View style={styles.colorMenuRow}>
              {TAG_COLORS.map((color) => (
                <Pressable key={color} onPress={() => colorMenuKey && pickColor(colorMenuKey, color)}>
                  <View style={[styles.colorSwatch, { backgroundColor: color }]} />
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    // Same level as DocumentsScreen's title.
    paddingTop: 90,
    paddingBottom: 12,
  },
  header: {
    // At least 2x the previous 22.
    fontSize: 46,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  headerButtonsDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  // White capsule tiles felt right on a plain page; on the gradient the
  // same glass surfaces as the rest of this redesign hold together better
  // than a solid white card would.
  wideTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(20,20,20,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  tile: {
    width: '48%',
    backgroundColor: 'rgba(20,20,20,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    marginBottom: 12,
  },
  tileLabel: {
    fontSize: 15,
    fontWeight: '500',
    fontFamily: FONT_MEDIUM,
  },
  tileMenuButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    padding: 4,
  },
  newTile: {
    borderStyle: 'dashed',
  },
  newTileLabel: {
    fontSize: 15,
    fontWeight: '500',
    fontFamily: FONT_MEDIUM,
    color: 'rgba(255,255,255,0.6)',
  },
  colorMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  colorMenuCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 320,
  },
  colorMenuTitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_REGULAR,
    color: '#111827',
    marginBottom: 14,
  },
  colorMenuRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
});
