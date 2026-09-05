import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';

const ACCENT = '#3B82F6';

type Tile = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  // Set only for the three tiles backed by the one `links` mirror collection
  // (see DocumentEditorScreen's fetchLinkPreview / LinksScreen's categoryOf) -
  // each opens the same screen pre-filtered to its own slice instead of a
  // "Скоро" placeholder.
  linkCategory?: 'video' | 'geo' | 'other';
  // Set for tiles with their own dedicated (paramless) screen.
  route?: 'Photos' | 'Files';
};

// "Справи", the link-backed tiles, "Фото" and "Файли" are real, working
// databases so far (see TasksScreen/LinksScreen/PhotosScreen/FilesScreen) -
// only "нагадування" from PROJECT_BRIEF.md's default-types list is still a
// placeholder, filled in the same way each of the above went from "just a
// block" to a real cross-document list.
const GRID_TILES: Tile[] = [
  { key: 'geo', label: 'Геоточки', icon: 'location-outline', color: '#16A34A', linkCategory: 'geo' },
  { key: 'links', label: 'Посилання', icon: 'link-outline', color: '#3B82F6', linkCategory: 'other' },
  { key: 'photos', label: 'Фото', icon: 'image-outline', color: '#EC4899', route: 'Photos' },
  { key: 'video', label: 'YouTube / TikTok', icon: 'videocam-outline', color: '#EF4444', linkCategory: 'video' },
  { key: 'files', label: 'Файли', icon: 'document-outline', color: '#8B5CF6', route: 'Files' },
];

export default function DatabasesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Бази даних</Text>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.wideTile} onPress={() => navigation.navigate('Tasks')}>
          <View style={[styles.tileIcon, { backgroundColor: '#EFF6FF' }]}>
            <Ionicons name="checkbox-outline" size={20} color={ACCENT} />
          </View>
          <Text style={styles.tileLabel}>Справи</Text>
        </Pressable>

        <View style={styles.grid}>
          {GRID_TILES.map((tile) => (
            <Pressable
              key={tile.key}
              style={styles.tile}
              onPress={() => {
                if (tile.linkCategory) {
                  navigation.navigate('Links', { category: tile.linkCategory });
                } else if (tile.route) {
                  navigation.navigate(tile.route);
                } else {
                  navigation.navigate('Placeholder', { icon: tile.icon, label: 'Скоро' });
                }
              }}
            >
              <View style={[styles.tileIcon, { backgroundColor: `${tile.color}1A` }]}>
                <Ionicons name={tile.icon} size={20} color={tile.color} />
              </View>
              <Text style={styles.tileLabel}>{tile.label}</Text>
            </Pressable>
          ))}

          <Pressable
            style={[styles.tile, styles.newTile]}
            onPress={() => navigation.navigate('Placeholder', { icon: 'add-outline', label: 'Скоро' })}
          >
            <View style={styles.newTileIcon}>
              <Ionicons name="add" size={20} color="#9CA3AF" />
            </View>
            <Text style={styles.newTileLabel}>Нова база</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  wideTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
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
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 16,
    gap: 10,
    marginBottom: 12,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  newTile: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
  },
  newTileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newTileLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#9CA3AF',
  },
});
