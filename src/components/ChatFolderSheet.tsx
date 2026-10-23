import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
// gesture-handler's ScrollView, not the core one: a sheet with a search field over a list (the sheet scroll trap).
import { ScrollView } from 'react-native-gesture-handler';
import ChatSheetFrame from './ChatSheetFrame';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import type { FolderOption } from '../utils/chatFolders';

// «ПАПКА ДЛЯ РОЗМОВИ» (sketch chatn, 2026-10-24): the explorer's real folders as an indented list, a search, the current one
// ticked, «Без папки» first. The conversation stays in its own list; the folder is only a mark on it.
export default function ChatFolderSheet({
  visible,
  chatTitle,
  folders,
  currentId,
  onPick,
  onClose,
}: {
  visible: boolean;
  chatTitle: string;
  folders: FolderOption[];
  currentId?: string;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const styles = useMemo(() => makeStyles(S), [S]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? folders.filter((f) => f.path.toLowerCase().includes(needle)) : folders;
  const row = (key: string, name: string, depth: number, on: boolean, onPress: () => void, dashed?: boolean) => (
    <Pressable key={key} onPress={onPress} style={[styles.row, { paddingLeft: 12 + depth * 22 }, on && styles.rowOn]} accessibilityLabel={name}>
      <Ionicons name={dashed ? 'folder-open-outline' : 'folder-outline'} size={20} color={on ? S.accent : S.ink2} />
      <Text style={[styles.rowText, on && { fontFamily: SOFT_SEMIBOLD }]} numberOfLines={1}>
        {name}
      </Text>
      {on ? <Ionicons name="checkmark" size={18} color={S.accent} /> : null}
    </Pressable>
  );
  return (
    <ChatSheetFrame visible={visible} onClose={onClose} top={130}>
      <View style={{ paddingHorizontal: 4 }}>
        <Text style={styles.title}>Папка для розмови</Text>
        <Text style={styles.sub} numberOfLines={1}>{`«${chatTitle}» · папки зі «Старту»`}</Text>
      </View>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={S.ink3} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Знайти папку" placeholderTextColor={S.ink3} style={styles.searchInput} />
      </View>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 2, paddingBottom: 8 }}>
        {!needle ? row('none', 'Без папки', 0, !currentId, () => onPick(null), true) : null}
        {shown.map((f) => row(f.id, needle ? f.path.split('/').join(' › ') : f.name, needle ? 0 : f.depth, f.id === currentId, () => onPick(f.id)))}
        {shown.length === 0 && needle ? <Text style={styles.empty}>Такої папки немає</Text> : null}
      </ScrollView>
      <Text style={styles.note}>Розмова лишається у своєму списку. Папка лише мітка.</Text>
    </ChatSheetFrame>
  );
}

function makeStyles(S: ReturnType<typeof useSoft>) {
  return StyleSheet.create({
    title: { fontSize: 20, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    sub: { fontSize: 12.5, fontFamily: SOFT_REGULAR, color: S.ink2, marginTop: 2 },
    search: { height: 40, borderRadius: 20, backgroundColor: S.card, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, boxShadow: S.shadow } as never,
    searchInput: { flex: 1, fontSize: 15, fontFamily: SOFT_REGULAR, color: S.ink, padding: 0 },
    row: { height: 48, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 12 },
    rowOn: { backgroundColor: S.dark ? '#534034' : '#F9EAE0' },
    rowText: { flex: 1, fontSize: 15.5, fontFamily: SOFT_MEDIUM, color: S.ink },
    empty: { fontSize: 14, color: S.ink2, fontFamily: SOFT_REGULAR, padding: 14, textAlign: 'center' },
    note: { textAlign: 'center', fontSize: 12.5, fontFamily: SOFT_REGULAR, color: S.ink2 },
  });
}
