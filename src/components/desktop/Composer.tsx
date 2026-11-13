import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { CONTROL, RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import { useExplorerPath } from '../../navigation/explorerPlace';
import { UNFILED } from '../../screens/ExplorerScreen';
import { calendarPlace, useCalendarDay } from '../../navigation/calendarPlace';
import { composerBus, useComposerOpen } from '../../navigation/composerBus';
import { navigationRef } from '../../navigationRef';
import { useTags } from '../../hooks/useTags';
import { dateKey } from '../../utils/dateLocale';
import {
  attachmentsFromFiles,
  discardAttachments,
  pickFileAttachments,
  pickPhotoAttachments,
  quickAddToDay,
  quickCreateBoard,
  quickCreateCard,
  quickCreateDocument,
  quickCreateLink,
  quickCreateTask,
  quickFileAttachments,
  type Attachment,
} from '../../utils/quickCreate';
import type { Tag } from '../../types';

// THE ONE PLACE TO CREATE on the Mac (frame B, after Claude's own composer). It is folded to a «+» at the foot of the main
// column and UNFOLDS from it - by a click on the «+», or by «Новий» in the sidebar (2026-10-31, the user's: it hung there for
// ever, and it only opened the old window). Unfolded it makes the thing itself, with the same writes as the quick-create
// window (utils/quickCreate): the text typed is the thing, the chip says what it becomes, Enter makes it, Esc folds it.
// Shown only where creating makes sense - the explorer and the calendar's day.
type Kind = 'document' | 'task' | 'day' | 'board' | 'card' | 'link';
const KINDS: { key: Kind; label: string; placeholder: string }[] = [
  { key: 'document', label: 'Нотатка', placeholder: 'Запиши нотатку…' },
  { key: 'task', label: 'Справа', placeholder: 'Що треба зробити…' },
  { key: 'day', label: 'У щоденник', placeholder: 'Що додати до щоденника…' },
  { key: 'board', label: 'Дошка', placeholder: 'Назва дошки…' },
  { key: 'card', label: 'Картка', placeholder: 'Термін, а далі пояснення…' },
  { key: 'link', label: 'Посилання', placeholder: 'Встав адресу https://…' },
];
const DAY_KINDS = KINDS.filter((k) => k.key === 'task' || k.key === 'day');

export const COMPOSER_CLEAR = 96;
const PLUS = 44;
const MAX_W = 760;
const SIDE = 24;

export default function Composer({ mode = 'explorer' }: { mode?: 'explorer' | 'calendar' }) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const open = useComposerOpen();
  const path = useExplorerPath();
  const day = useCalendarDay();
  const calendar = mode === 'calendar';
  const folderPath = calendar || !path || path === UNFILED ? '' : path;
  const where = calendar ? day : !folderPath ? 'Нерозкладене' : folderPath.split('/').pop() ?? folderPath;
  const kinds = calendar ? DAY_KINDS : KINDS;
  const { tags, attachTag, createFolderTag } = useTags();
  const [kind, setKind] = useState<Kind>(calendar ? 'task' : 'document');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [told, setTold] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const input = useRef<TextInput>(null);
  // The unfolding: the field grows leftwards out of its «+» (width), its contents standing still and being revealed.
  const [hostW, setHostW] = useState(MAX_W + SIDE * 2);
  const targetW = Math.min(MAX_W, Math.max(PLUS, hostW - SIDE * 2));
  const [mounted, setMounted] = useState(false);
  const p = useRef(new Animated.Value(0)).current;
  const pending = useRef<Attachment[]>([]);
  pending.current = attachments;
  const current = kinds.find((k) => k.key === kind) ?? kinds[0];

  // A new place (the explorer ↔ the calendar) starts on its own first kind; leaving folds the composer.
  useEffect(() => {
    setKind(calendar ? 'task' : 'document');
    return () => composerBus.close();
  }, [calendar]);
  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(p, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      setTimeout(() => input.current?.focus(), 120);
    } else {
      // Folded without making anything: what was attached for it goes away again.
      if (pending.current.length) {
        discardAttachments(pending.current);
        setAttachments([]);
      }
      Animated.timing(p, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!told) return;
    const id = setTimeout(() => setTold(''), 2600);
    return () => clearTimeout(id);
  }, [told]);

  async function tagForPath(p: string): Promise<Tag> {
    const same = tags.filter((t) => t.path === p).sort((a, b) => b.types.length - a.types.length);
    if (same.length) return same[0];
    const color = '#DAA587';
    const id = await createFolderTag(p, [], color);
    return { id, path: p, icon: 'folder-outline', color, types: [], usedIn: {}, keep: true };
  }

  async function make() {
    const value = text.trim();
    const list = attachments;
    const standalone = !value && list.length > 0;
    if ((!value && !standalone) || busy) return;
    setBusy(true);
    try {
      // From here the made thing owns them: folding must not discard them.
      pending.current = [];
      setAttachments([]);
      const nav = navigationRef.navigate as unknown as (name: string, params?: object) => void;
      const attach = attachTag as never;
      if (standalone) {
        const tag = folderPath ? await tagForPath(folderPath) : null;
        await quickFileAttachments(list, tag, attach);
        setTold(folderPath ? `Збережено в «${where}»` : 'Збережено');
      } else if (kind === 'task') {
        await quickCreateTask(value, list, calendar ? calendarPlace.dayKey || undefined : undefined);
        setTold(calendar ? 'Справу додано на день' : 'Справу додано до «Вхідних»');
      } else if (kind === 'day') {
        await quickAddToDay(value, list, calendar ? calendarPlace.dayKey || dateKey(new Date()) : dateKey(new Date()));
        setTold('Додано до щоденника');
      } else {
        const tag = folderPath ? await tagForPath(folderPath) : null;
        if (kind === 'document') nav('Editor', { documentId: await quickCreateDocument(value, tag, attach, list), autoFocusTitle: true });
        else if (kind === 'board') nav('BoardCopy', { boardId: await quickCreateBoard(value, tag, attach) });
        else if (kind === 'card') {
          await quickCreateCard(value, tag, attach, list);
          setTold('Картку створено');
        } else if (kind === 'link') {
          const id = await quickCreateLink(value, tag, attach);
          if (!id) throw new Error('Встав адресу, наприклад https://…');
          setTold('Посилання збережено');
        }
      }
      setText('');
      composerBus.close();
    } catch (e) {
      pending.current = list;
      setAttachments(list);
      setTold((e as Error).message || 'Не вдалося створити');
    } finally {
      setBusy(false);
    }
  }

  const canAttach = kind !== 'board' && kind !== 'link';
  async function addFrom(pick: () => Promise<Attachment[]>) {
    if (!canAttach) return;
    try {
      const added = await pick();
      if (added.length) setAttachments((prev) => [...prev, ...added]);
    } catch (e) {
      setTold((e as Error).message || 'Не вдалося додати');
    }
  }
  function removeAttachment(a: Attachment) {
    setAttachments((prev) => prev.filter((x) => x.id !== a.id));
    discardAttachments([a]);
  }
  // A picture or a file pasted into the field (⌘V) is attached, not typed.
  const onPaste = (e: unknown) => {
    const files = Array.from((e as ClipboardEvent).clipboardData?.files ?? []);
    if (files.length === 0 || !canAttach) return;
    (e as { preventDefault?: () => void }).preventDefault?.();
    addFrom(() => attachmentsFromFiles(files));
  };

  // The browser's paste is heard on the field itself (the web TextInput passes no onPaste on).
  const pasteRef = useRef(onPaste);
  pasteRef.current = onPaste;
  useEffect(() => {
    if (!mounted) return;
    const node = input.current as unknown as HTMLElement | null;
    if (!node || !node.addEventListener) return;
    const handler = (e: Event) => pasteRef.current(e);
    node.addEventListener('paste', handler);
    return () => node.removeEventListener('paste', handler);
  }, [mounted]);

  const width = p.interpolate({ inputRange: [0, 1], outputRange: [PLUS, targetW] });
  const plusOpacity = p.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: 'clamp' });
  const plusButton = (
    <Animated.View style={{ opacity: plusOpacity, position: mounted ? 'absolute' : 'relative', right: 0, bottom: 0 }} pointerEvents={open ? 'none' : 'auto'}>
      <Pressable
        onPress={() => composerBus.open()}
        accessibilityLabel="Створити"
        style={[styles.plus, { backgroundColor: D.card, borderColor: D.line, boxShadow: D.soft.shadow }]}
      >
        <Ionicons name="add" size={22} color={D.ink} />
      </Pressable>
    </Animated.View>
  );
  if (!mounted) {
    return (
      <View pointerEvents="box-none" style={styles.host} onLayout={(e) => setHostW(e.nativeEvent.layout.width)}>
        {!!told && (
          <View style={[styles.toast, { backgroundColor: D.ink }]}>
            <Text style={[styles.toastText, { color: D.card }]}>{told}</Text>
          </View>
        )}
        {plusButton}
      </View>
    );
  }
  return (
    <View pointerEvents="box-none" style={styles.host} onLayout={(e) => setHostW(e.nativeEvent.layout.width)}>
      <View style={{ width: targetW, height: 0 }} />
      <Animated.View style={[styles.box, { width, opacity: p, backgroundColor: D.card, borderColor: D.line, boxShadow: D.soft.shadow, overflow: 'hidden' }]}>
        <View style={{ width: targetW - 2, alignSelf: 'flex-end', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 9, gap: 9 }}>
          {attachments.length > 0 && (
            <View style={styles.attachRow}>
              {attachments.map((a) => (
                <View key={a.id} style={[styles.attach, { backgroundColor: D.fill }]}>
                  {a.kind === 'photo' ? (
                    <Image source={{ uri: a.uri }} style={styles.thumb} />
                  ) : (
                    <Ionicons name="document-outline" size={16} color={D.ink2} />
                  )}
                  {a.kind === 'file' && (
                    <Text style={[styles.attachName, { color: D.ink2 }]} numberOfLines={1}>
                      {a.name}
                    </Text>
                  )}
                  <Pressable onPress={() => removeAttachment(a)} hitSlop={6} accessibilityLabel="Прибрати">
                    <Ionicons name="close" size={14} color={D.ink3} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <View style={styles.row}>
            <Pressable onPress={() => composerBus.close()} accessibilityLabel="Згорнути" hitSlop={8}>
              <Ionicons name="close" size={18} color={D.ink2} />
            </Pressable>
            <Pressable onPress={() => addFrom(() => pickPhotoAttachments('gallery'))} accessibilityLabel="Додати фото" hitSlop={6} style={{ opacity: canAttach ? 1 : 0.35 }}>
              <Ionicons name="image-outline" size={19} color={D.ink2} />
            </Pressable>
            <Pressable onPress={() => addFrom(pickFileAttachments)} accessibilityLabel="Додати файл" hitSlop={6} style={{ opacity: canAttach ? 1 : 0.35 }}>
              <Ionicons name="attach-outline" size={19} color={D.ink2} />
            </Pressable>
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              multiline
              placeholder={current.placeholder}
              placeholderTextColor={D.ink3}
              style={[styles.input, { color: D.ink }]}
              onKeyPress={(e) => {
                const key = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
                if (key.key === 'Enter' && !key.shiftKey) {
                  (e as unknown as { preventDefault: () => void }).preventDefault();
                  make();
                } else if (key.key === 'Escape') composerBus.close();
              }}
            />
            <Pressable
              onPress={make}
              accessibilityLabel="Створити"
              style={[styles.send, { backgroundColor: text.trim() || attachments.length ? D.ink : D.fill }]}
            >
              <Ionicons name="arrow-up" size={16} color={text.trim() || attachments.length ? D.card : D.ink3} />
            </Pressable>
          </View>
          <View style={styles.under}>
            {kinds.map((k) => {
              const on = k.key === kind;
              return (
                <Pressable key={k.key} onPress={() => { setKind(k.key); input.current?.focus(); }} style={[styles.chip, { backgroundColor: on ? D.ink : D.fill }]}>
                  <Text style={[styles.chipText, { color: on ? D.card : D.ink2 }]}>{k.label}</Text>
                </Pressable>
              );
            })}
            <Text style={[styles.where, { color: told ? D.ink : D.ink3 }]} numberOfLines={1}>
              {told || (calendar ? where : `у «${where}»`)}
            </Text>
          </View>
        </View>
      </Animated.View>
      {plusButton}
    </View>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    host: { position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'flex-end', paddingRight: SIDE, zIndex: 20 },
    plus: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
    toast: { borderRadius: 999, paddingHorizontal: 14, height: 30, justifyContent: 'center', marginBottom: 10 },
    toastText: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD },
    box: {
      borderRadius: RADIUS.panel,
      borderWidth: StyleSheet.hairlineWidth,
    },
    attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    attach: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, padding: 4, paddingRight: 8, maxWidth: 220 },
    thumb: { width: 36, height: 36, borderRadius: 7 },
    attachName: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR, flexShrink: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: CONTROL.button },
    input: { flex: 1, fontSize: TYPE.md, fontFamily: FONT_REGULAR, maxHeight: 140, paddingVertical: 6, outlineStyle: 'none' as never },
    send: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    under: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    chip: { borderRadius: 999, paddingHorizontal: 10, height: 24, justifyContent: 'center' },
    chipText: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD },
    where: { marginLeft: 'auto' as never, fontSize: TYPE.xs, fontFamily: FONT_REGULAR, maxWidth: 260 },
  });
