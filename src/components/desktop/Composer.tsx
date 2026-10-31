import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { quickAddToDay, quickCreateBoard, quickCreateCard, quickCreateDocument, quickCreateLink, quickCreateTask } from '../../utils/quickCreate';
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
  const input = useRef<TextInput>(null);
  const current = kinds.find((k) => k.key === kind) ?? kinds[0];

  // A new place (the explorer ↔ the calendar) starts on its own first kind; leaving folds the composer.
  useEffect(() => {
    setKind(calendar ? 'task' : 'document');
    return () => composerBus.close();
  }, [calendar]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 40);
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
    if (!value || busy) return;
    setBusy(true);
    try {
      const nav = navigationRef.navigate as unknown as (name: string, params?: object) => void;
      const attach = attachTag as never;
      if (kind === 'task') {
        await quickCreateTask(value, [], calendar ? calendarPlace.dayKey || undefined : undefined);
        setTold(calendar ? 'Справу додано на день' : 'Справу додано до «Вхідних»');
      } else if (kind === 'day') {
        await quickAddToDay(value, [], calendar ? calendarPlace.dayKey || dateKey(new Date()) : dateKey(new Date()));
        setTold('Додано до щоденника');
      } else {
        const tag = folderPath ? await tagForPath(folderPath) : null;
        if (kind === 'document') nav('Editor', { documentId: await quickCreateDocument(value, tag, attach), autoFocusTitle: true });
        else if (kind === 'board') nav('BoardCopy', { boardId: await quickCreateBoard(value, tag, attach) });
        else if (kind === 'card') {
          await quickCreateCard(value, tag, attach);
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
      setTold((e as Error).message || 'Не вдалося створити');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <View pointerEvents="box-none" style={styles.host}>
        {!!told && (
          <View style={[styles.toast, { backgroundColor: D.ink }]}>
            <Text style={[styles.toastText, { color: D.card }]}>{told}</Text>
          </View>
        )}
        <Pressable
          onPress={() => composerBus.open()}
          accessibilityLabel="Створити"
          style={[styles.plus, { backgroundColor: D.card, borderColor: D.line, boxShadow: D.soft.shadow }]}
        >
          <Ionicons name="add" size={22} color={D.ink} />
        </Pressable>
      </View>
    );
  }
  return (
    <View pointerEvents="box-none" style={styles.host}>
      <View
        {...({ dataSet: { fadeIn: '1', origin: 'center' } } as object)}
        style={[styles.box, { backgroundColor: D.card, borderColor: D.line, boxShadow: D.soft.shadow }]}
      >
        <View style={styles.row}>
          <Pressable onPress={() => composerBus.close()} accessibilityLabel="Згорнути" hitSlop={8}>
            <Ionicons name="close" size={18} color={D.ink2} />
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
            style={[styles.send, { backgroundColor: text.trim() ? D.ink : D.fill }]}
          >
            <Ionicons name="arrow-up" size={16} color={text.trim() ? D.card : D.ink3} />
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
    </View>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    host: { position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center', zIndex: 20 },
    plus: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
    toast: { borderRadius: 999, paddingHorizontal: 14, height: 30, justifyContent: 'center', marginBottom: 10 },
    toastText: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD },
    box: {
      width: '100%',
      maxWidth: 760,
      marginHorizontal: 30,
      borderRadius: RADIUS.panel,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 9,
      gap: 9,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: CONTROL.button },
    input: { flex: 1, fontSize: TYPE.md, fontFamily: FONT_REGULAR, maxHeight: 140, paddingVertical: 6, outlineStyle: 'none' as never },
    send: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    under: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    chip: { borderRadius: 999, paddingHorizontal: 10, height: 24, justifyContent: 'center' },
    chipText: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD },
    where: { marginLeft: 'auto' as never, fontSize: TYPE.xs, fontFamily: FONT_REGULAR, maxWidth: 260 },
  });
