import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import TextInput from './AppTextInput';
// gesture-handler's ScrollView, not the core one: a sheet with a search field over a list (the sheet scroll trap).
import { ScrollView } from 'react-native-gesture-handler';
import ChatSheetFrame from './ChatSheetFrame';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import type { ChatSummary } from '../utils/assistant';
import { folderOfPointer, type FolderOption } from '../utils/chatFolders';

// «РОЗМОВИ» (sketches chatl and chatm, 2026-10-24): every conversation in a list like GPT's and Gemini's - search, a group
// «Без папки», then a group for each explorer folder a conversation was filed under. A hold on a row opens a small menu:
// Папка…, Інструкція розмови…, Перейменувати, Видалити розмову (asks first). Props in, callbacks out: the owner does the work.
type Props = {
  visible: boolean;
  chats: ChatSummary[];
  currentId?: string;
  folders: FolderOption[];
  onClose: () => void;
  onOpen: (chatId: string) => void;
  onNew: () => void;
  onFolder: (chatId: string) => void;
  onInstruction: (chatId: string) => void;
  onRename: (chatId: string, title: string) => void;
  onDelete: (chatId: string) => void;
};

const MONTHS = ['січ.', 'лют.', 'бер.', 'квіт.', 'трав.', 'черв.', 'лип.', 'серп.', 'вер.', 'жовт.', 'лист.', 'груд.'];
export function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86400000);
  if (diff === 0) return 'сьогодні';
  if (diff === 1) return 'вчора';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function thoughtsLabel(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  const word = tens >= 11 && tens <= 14 ? 'думок' : last === 1 ? 'думка' : last >= 2 && last <= 4 ? 'думки' : 'думок';
  return `${n} ${word}`;
}

export default function ChatsSheet({ visible, chats, currentId, folders, onClose, onOpen, onNew, onFolder, onInstruction, onRename, onDelete }: Props) {
  const S = useSoft();
  const styles = useMemo(() => makeStyles(S), [S]);
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ id: string; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setMenu(null);
      setRenaming(null);
      setConfirm(null);
    }
  }, [visible]);

  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const list = chats
      .filter((c) => c.count > 0)
      .filter((c) => !needle || c.title.toLowerCase().includes(needle) || (c.summary ?? '').toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const loose: ChatSummary[] = [];
    const byFolder = new Map<string, { folder: FolderOption; items: ChatSummary[] }>();
    list.forEach((c) => {
      const f = folderOfPointer(folders, c.folderId);
      if (!f) loose.push(c);
      else byFolder.set(f.id, { folder: f, items: [...(byFolder.get(f.id)?.items ?? []), c] });
    });
    return { loose, folderGroups: [...byFolder.values()].sort((a, b) => a.folder.path.localeCompare(b.folder.path, 'uk')) };
  }, [chats, folders, needle]);

  const held = menu ? chats.find((c) => c.id === menu.id) : null;
  const doomed = confirm ? chats.find((c) => c.id === confirm) : null;

  const row = (c: ChatSummary, folderName?: string) => {
    const isHeld = menu?.id === c.id;
    const editing = renaming?.id === c.id;
    return (
      <Pressable
        key={c.id}
        onPress={() => (editing ? undefined : onOpen(c.id))}
        onLongPress={(e) => setMenu({ id: c.id, y: e.nativeEvent.pageY })}
        delayLongPress={350}
        style={[styles.row, isHeld && styles.rowHeld, c.id === currentId && !isHeld && styles.rowCurrent]}
        accessibilityLabel={c.title}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          {editing ? (
            <TextInput
              value={renaming!.text}
              onChangeText={(text) => setRenaming({ id: c.id, text })}
              onSubmitEditing={() => {
                onRename(c.id, renaming!.text.trim());
                setRenaming(null);
              }}
              onBlur={() => setRenaming(null)}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              style={styles.rowInput}
            />
          ) : (
            <Text style={styles.rowTitle} numberOfLines={1}>
              {c.title}
            </Text>
          )}
          <Text style={styles.rowSub}>{`${dayLabel(c.updatedAt)} · ${thoughtsLabel(c.userTurns)}${c.instruction ? ' · з інструкцією' : ''}`}</Text>
        </View>
        {folderName ? (
          <View style={styles.folderChip}>
            <Ionicons name="folder-outline" size={13} color={S.accent} />
            <Text style={styles.folderChipText} numberOfLines={1}>
              {folderName}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };
  const head = (label: string, count: number, icon?: boolean) => (
    <View key={`h-${label}`} style={styles.groupHead}>
      {icon ? <Ionicons name="folder-outline" size={15} color={S.ink2} /> : null}
      <Text style={styles.groupText}>{label.toUpperCase()}</Text>
      <Text style={styles.groupCount}>{count}</Text>
    </View>
  );

  const items: { icon: string; label: string; danger?: boolean; run: () => void }[] = held
    ? [
        { icon: 'folder-outline', label: 'Папка…', run: () => { setMenu(null); onFolder(held.id); } },
        { icon: 'book-outline', label: 'Інструкція розмови…', run: () => { setMenu(null); onInstruction(held.id); } },
        { icon: 'create-outline', label: 'Перейменувати', run: () => { setMenu(null); setRenaming({ id: held.id, text: held.title }); } },
        { icon: 'trash-outline', label: 'Видалити розмову', danger: true, run: () => { setMenu(null); setConfirm(held.id); } },
      ]
    : [];
  const menuTop = menu ? Math.max(120, Math.min(menu.y + 10, height - 300)) : 0;

  return (
    <>
      <ChatSheetFrame visible={visible} onClose={() => (menu ? setMenu(null) : onClose())} top={84}>
        <View style={{ paddingHorizontal: 4 }}>
          <Text style={styles.title}>Розмови</Text>
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={S.ink3} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Пошук розмов" placeholderTextColor={S.ink3} style={styles.searchInput} />
        </View>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
          {groups.loose.length > 0 ? head('Без папки', groups.loose.length) : null}
          {groups.loose.map((c) => row(c))}
          {groups.folderGroups.map((g) => [head(g.folder.name, g.items.length, true), ...g.items.map((c) => row(c, g.folder.name))])}
          {groups.loose.length === 0 && groups.folderGroups.length === 0 ? <Text style={styles.empty}>{needle ? 'Нічого не знайшлося' : 'Розмов ще немає'}</Text> : null}
        </ScrollView>
        <Text style={styles.hintLine}>Утримай розмову: папка, інструкція, видалити</Text>
        <View style={{ alignItems: 'center' }}>
          <Pressable onPress={onNew} style={styles.newChat} accessibilityLabel="Нова розмова">
            <Ionicons name="add" size={18} color={S.card} />
            <Text style={styles.newChatText}>Нова розмова</Text>
          </Pressable>
        </View>
      </ChatSheetFrame>
      {visible && menu ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} accessibilityLabel="Закрити меню" />
          <View style={[styles.menu, { top: menuTop }]}>
            {items.map((it) => (
              <Pressable key={it.label} onPress={it.run} style={styles.menuRow} accessibilityLabel={it.label}>
                <Ionicons name={it.icon as never} size={20} color={it.danger ? S.accent : S.ink} />
                <Text style={[styles.menuText, it.danger && { color: S.accent }]}>{it.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      {visible && doomed ? (
        <>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} onPress={() => setConfirm(null)} accessibilityLabel="Не видаляти" />
          <View style={styles.confirm}>
            <Text style={styles.confirmTitle}>Видалити розмову?</Text>
            <Text style={styles.confirmText} numberOfLines={3}>
              {`«${doomed.title}» зникне разом з її нотатками й дошкою. Те, що ти вже зберіг у провідник, лишиться.`}
            </Text>
            <View style={styles.confirmRow}>
              <Pressable onPress={() => setConfirm(null)} style={styles.confirmSide}>
                <Text style={styles.confirmSideText}>Скасувати</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const id = doomed.id;
                  setConfirm(null);
                  onDelete(id);
                }}
                style={styles.confirmMain}
                accessibilityLabel="Видалити розмову"
              >
                <Text style={styles.confirmMainText}>Видалити</Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : null}
    </>
  );
}

function makeStyles(S: ReturnType<typeof useSoft>) {
  const wash = S.dark ? '#534034' : '#F9EAE0';
  return StyleSheet.create({
    title: { fontSize: 20, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    search: { height: 40, borderRadius: 20, backgroundColor: S.card, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, boxShadow: S.shadow } as never,
    searchInput: { flex: 1, fontSize: 15, fontFamily: SOFT_REGULAR, color: S.ink, padding: 0 },
    groupHead: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 6, paddingTop: 6 },
    groupText: { flex: 1, fontSize: 11.5, letterSpacing: 0.4, fontFamily: SOFT_SEMIBOLD, color: S.ink2 },
    groupCount: { fontSize: 11.5, fontFamily: SOFT_MEDIUM, color: S.ink2 },
    row: { minHeight: 64, borderRadius: 20, backgroundColor: S.card, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 14, paddingRight: 12, boxShadow: S.shadow } as never,
    rowHeld: { boxShadow: `0 0 0 2px ${S.accent}` } as never,
    rowCurrent: { boxShadow: `0 0 0 1.5px ${S.line}` } as never,
    rowTitle: { fontSize: 15.5, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    rowInput: { fontSize: 15.5, fontFamily: SOFT_SEMIBOLD, color: S.ink, padding: 0 },
    rowSub: { fontSize: 12.5, fontFamily: SOFT_REGULAR, color: S.ink2 },
    folderChip: { maxWidth: 130, height: 26, borderRadius: 13, paddingHorizontal: 10, backgroundColor: wash, flexDirection: 'row', alignItems: 'center', gap: 5 },
    folderChipText: { flexShrink: 1, fontSize: 12, fontFamily: SOFT_SEMIBOLD, color: S.accent },
    empty: { fontSize: 14, color: S.ink2, fontFamily: SOFT_REGULAR, padding: 20, textAlign: 'center' },
    hintLine: { textAlign: 'center', fontSize: 12.5, fontFamily: SOFT_REGULAR, color: S.ink2 },
    newChat: { height: 40, borderRadius: 20, paddingHorizontal: 20, backgroundColor: S.ink, flexDirection: 'row', alignItems: 'center', gap: 8 },
    newChatText: { fontSize: 15, fontFamily: SOFT_MEDIUM, color: S.card },
    menu: { position: 'absolute', left: 34, right: 100, borderRadius: 22, backgroundColor: S.card, paddingVertical: 6, borderWidth: 1, borderColor: S.line, boxShadow: '0 12px 34px rgba(0,0,0,0.35)' } as never,
    menuRow: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
    menuText: { fontSize: 15.5, fontFamily: SOFT_MEDIUM, color: S.ink },
    confirm: { position: 'absolute', left: 24, right: 24, top: '34%', borderRadius: 26, backgroundColor: S.card, padding: 18, gap: 8, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' } as never,
    confirmTitle: { fontSize: 18, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    confirmText: { fontSize: 14, lineHeight: 20, fontFamily: SOFT_REGULAR, color: S.ink2 },
    confirmRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
    confirmSide: { height: 40, borderRadius: 20, paddingHorizontal: 18, borderWidth: 1, borderColor: S.line, alignItems: 'center', justifyContent: 'center' },
    confirmSideText: { fontSize: 15, fontFamily: SOFT_MEDIUM, color: S.ink },
    confirmMain: { height: 40, borderRadius: 20, paddingHorizontal: 18, backgroundColor: S.accent, alignItems: 'center', justifyContent: 'center' },
    confirmMainText: { fontSize: 15, fontFamily: SOFT_MEDIUM, color: '#FFFFFF' },
  });
}
