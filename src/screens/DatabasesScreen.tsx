import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection } from '@react-native-firebase/firestore';
import { addDoc, setDoc } from '../utils/owned';
import {
  GRID_TILES,
  Tile,
  WIDE_TILE_ICON,
  WIDE_TILE_KEY,
  WIDE_TILE_LABEL,
  openDatabaseTile,
  tileColorsDoc,
} from '../constants/databaseTiles';
import { useDatabaseTiles } from '../hooks/useDatabaseTiles';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { TAG_COLORS } from '../constants/tags';
import { FONT_REGULAR, FONT_MEDIUM, FONT_BOLD } from '../utils/fonts';
import { colorForDocument } from '../utils/documentColor';
import RenamePrompt from '../components/RenamePrompt';
import ImportTableSheet from '../components/ImportTableSheet';
import ContentColumn from '../components/ContentColumn';
import { GLASS_BODY, GLASS_TEXT } from '../constants/glass';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import { GLASS_ISLAND } from '../constants/glass';
import { CAPSULE_DROP, CHROME_TOP, RAIL_CLEARANCE, RAIL_RIGHT } from '../constants/rail';

export default function DatabasesScreen() {
  const databasesBlurTarget = useBlurTarget();
  const databasesFocused = useIsFocused();
  const databasesInsets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { colorFor, customDatabases } = useDatabaseTiles();
  const [colorMenuKey, setColorMenuKey] = useState<string | null>(null);
  const [creatingDatabase, setCreatingDatabase] = useState(false);
  const [importing, setImporting] = useState(false);

  async function createDatabase(name: string) {
    setCreatingDatabase(false);
    const now = Date.now();
    const ref = await addDoc(collection(db, 'customDatabases'), {
      name,
      fields: [{ id: `${now}-title`, name: 'Назва', type: 'text' }],
      createdAt: now,
      updatedAt: now,
    });
    navigation.navigate('CustomDatabase', { databaseId: ref.id });
  }

  function pickColor(key: string, color: string) {
    setDoc(tileColorsDoc, { [key]: color }, { merge: true });
    setColorMenuKey(null);
  }

  function openTile(tile: Tile) {
    openDatabaseTile(navigation, tile);
  }

  return (
    <View style={styles.container}>
      {/* Same fixed gradient as Documents/Calendar. 1px bled past every edge
          (see the -1/+2 below) - windowWidth/Height can round to a hair
          less than the actual screen, leaving a sliver of the default
          white background visible at an edge otherwise. */}
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="databasesBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#databasesBg)" />
      </Svg>
      {/* The rail, as on every other screen: right edge, same width, same
          glass, hanging from the same line. Through the portal for the
          blur, so it withdraws when this screen isn't the one on show. */}
      {databasesFocused && (
        <GlassPortal>
          <View
            style={[styles.railWrap, { top: databasesInsets.top + CHROME_TOP + CAPSULE_DROP }]}
            pointerEvents="box-none"
          >
            <View style={styles.headerButtons}>
              <BlurView
                intensity={60}
                tint="dark"
                blurMethod="dimezisBlurView"
                blurTarget={databasesBlurTarget ?? undefined}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <Pressable hitSlop={8} onPress={() => navigation.navigate('Search')}>
                <Ionicons name="search-outline" size={24} color="#fff" />
              </Pressable>
              <View style={styles.headerButtonsDivider} />
              <Pressable hitSlop={8} onPress={() => navigation.navigate('Settings')}>
                <Ionicons name="ellipsis-horizontal-outline" size={24} color="#fff" />
              </Pressable>
            </View>
          </View>
        </GlassPortal>
      )}

      <ContentColumn>
        <View style={styles.headerRow}>
          <Text style={styles.header}>Бази даних</Text>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable style={styles.wideTile} onPress={() => navigation.navigate('Tasks')}>
            <Ionicons name={WIDE_TILE_ICON} size={22} color={colorFor(WIDE_TILE_KEY)} />
            <Text style={[styles.tileLabel, { color: colorFor(WIDE_TILE_KEY) }]}>{WIDE_TILE_LABEL}</Text>
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

            {/* Everything above is built in; everything below it is yours -
                the databases you made and the two tiles that make more.
                Full width on purpose: inside a wrapping row that is also
                what forces the break, so the line never ends up sharing a
                row with a tile. */}
            <View style={styles.sectionRule} />

            {customDatabases.map((cdb) => {
              const color = cdb.color ?? colorForDocument(cdb.id).background;
              return (
                <Pressable
                  key={cdb.id}
                  style={styles.tile}
                  onPress={() => navigation.navigate('CustomDatabase', { databaseId: cdb.id })}
                >
                  <Ionicons name={(cdb.icon as keyof typeof Ionicons.glyphMap) ?? 'grid-outline'} size={22} color={color} />
                  <Text style={[styles.tileLabel, { color }]} numberOfLines={1}>
                    {cdb.name}
                  </Text>
                </Pressable>
              );
            })}

            <Pressable style={[styles.tile, styles.newTile]} onPress={() => setCreatingDatabase(true)}>
              <Ionicons name="add" size={22} color="rgba(255,255,255,0.6)" />
              <Text style={styles.newTileLabel}>Нова база</Text>
            </Pressable>

            <Pressable style={[styles.tile, styles.newTile]} onPress={() => setImporting(true)}>
              <Ionicons name="download-outline" size={22} color="rgba(255,255,255,0.6)" />
              <Text style={styles.newTileLabel}>Імпорт таблиці</Text>
            </Pressable>
          </View>
        </ScrollView>

        <ImportTableSheet
          visible={importing}
          otherDatabases={customDatabases.map((d) => ({ id: d.id, name: d.name }))}
          onClose={() => setImporting(false)}
          onDone={(databaseId, rowCount) => {
            setImporting(false);
            Alert.alert('Імпортовано', `Додано записів: ${rowCount}`);
            navigation.navigate('CustomDatabase', { databaseId });
          }}
        />

        <RenamePrompt
          visible={creatingDatabase}
          title="Нова база"
          initialValue=""
          placeholder="Назва бази"
          onCancel={() => setCreatingDatabase(false)}
          onSave={createDatabase}
        />

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
      </ContentColumn>

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
    paddingLeft: 20,
    paddingRight: RAIL_CLEARANCE,
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
  railWrap: {
    position: 'absolute',
    right: RAIL_RIGHT,
    alignItems: 'center',
  },
  // Stood on its end, like every other screen's.
  headerButtons: {
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
    paddingHorizontal: 19,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  // Turned with the capsule.
  headerButtonsDivider: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  content: {
    // Full width: the tiles pass UNDER the rail, and the glass over them
    // is the point of it.
    paddingHorizontal: 20,
    // Clears FloatingIslandTabBar (bottom: 24, ~64 tall) so the last tile
    // can be scrolled out from under it - same 120 DocumentsScreen's own
    // list already uses.
    paddingBottom: 120,
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
  sectionRule: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginTop: 4,
    marginBottom: 16,
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
    backgroundColor: GLASS_BODY,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 320,
  },
  colorMenuTitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
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
