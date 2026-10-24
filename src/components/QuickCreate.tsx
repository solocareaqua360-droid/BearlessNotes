import { useEffect, useMemo, useRef, useState } from 'react';
import { folderPathFromName } from '../utils/folderName';
import { BackHandler, Keyboard, useWindowDimensions, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Sheet from './surfaces/Sheet';
import StableTextInput from './StableTextInput';
import { Ionicons } from './icons/Ionicons';
import { ask, notify } from './surfaces/Ask';
import { useSoft } from '../theme/soft';
import { MONTH_FULL, MONTH_SHORT, addDays, dateKey, getMonthGrid, parseDateKey } from '../utils/dateLocale';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useDockGlass } from '../utils/dockGlass';
import {
  discardAttachments,
  pickFileAttachments,
  pickPhotoAttachments,
  type Attachment,
  type QuickKind,
} from '../utils/quickCreate';

// THE QUICK-CREATE WINDOW (2026-10-13, the user's: «одне поле вводу для всього - починаєш писати, а що це і в яку
// папку - обираєш потім; ти не закінчуєш нотатку кнопкою, ти просто розгортаєш її на повний екран»). It replaces the
// «+» fan, which stays in the code as an idea that worked and was not needed (components/CreateFan).
//
//   the field      - already focused; what is typed is the thing.
//   the row below  - what it becomes: note · task · for the day · to a note · board · card · link. One row, no menus.
//   the top row    - the folder chip (a search over every folder, the folder you stand in first, «Нова папка» as the
//                    first row of what you type), then a photo, a file, close.
//   photo / file   - go INTO whatever is being made; with the text erased they are simply a photo or a file, filed in
//                    the chosen folder, else left in their own base.
//   «Створити»     - makes it and OPENS it (a note, the day's note, the note written to) on the full screen; a task, a
//                    card, a link, a photo are saved and the window closes.

type Level = 'compose' | 'folder' | 'doc' | 'day';

const DAY_HEADS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

// «Сьогодні» / «Завтра» / «Вчора», else «14 жов»
function dayLabel(key: string): string {
  const date = parseDateKey(key);
  const today = new Date();
  if (key === dateKey(today)) return 'Сьогодні';
  if (key === dateKey(addDays(today, 1))) return 'Завтра';
  if (key === dateKey(addDays(today, -1))) return 'Вчора';
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
}

const TYPES: { key: QuickKind; icon: string; label: string; placeholder: string }[] = [
  { key: 'document', icon: 'document-text-outline', label: 'Нотатка', placeholder: 'Нова нотатка' },
  { key: 'task', icon: 'checkbox-outline', label: 'Справа', placeholder: 'Нова справа' },
  { key: 'day', icon: 'calendar-outline', label: 'У щоденник', placeholder: 'Додати до щоденника' },
  { key: 'append', icon: 'create-outline', label: 'До нотатки', placeholder: 'Додати до нотатки' },
  { key: 'board', icon: 'easel-outline', label: 'Дошка', placeholder: 'Назва дошки' },
  { key: 'card', icon: 'albums-outline', label: 'Картка', placeholder: 'Термін, а під ним пояснення' },
  { key: 'link', icon: 'link-outline', label: 'Посилання', placeholder: 'Встав адресу' },
];

export default function QuickCreate({
  visible,
  onClose,
  folder,
  folderPaths,
  documents,
  initialKind,
  tasksOnDay,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  // The folder being looked at ('' = the root).
  folder: string;
  folderPaths: string[];
  documents: { id: string; title: string }[];
  // The type the window starts on (the calendar's «+» starts on «У щоденник»).
  initialKind?: QuickKind;
  // In the calendar a task is SET for the chosen day (the chip shows it and opens the month); elsewhere it goes to «Вхідні».
  tasksOnDay?: boolean;
  onSubmit: (
    kind: QuickKind | 'files',
    text: string,
    folder: string,
    attachments: Attachment[],
    opts: { open: boolean; documentId?: string; dayKey?: string }
  ) => Promise<void> | void;
}) {
  const S = useSoft();
  const glassOn = useDockGlass();
  // The window rides the keyboard (Sheet anchor), so a LIST in it is capped in points - a share of the screen that
  // leaves room for the keyboard under it.
  const { height: windowH } = useWindowDimensions();
  const inputRef = useRef<TextInput>(null);
  const [kind, setKind] = useState<QuickKind>('document');
  const [text, setText] = useState('');
  const [where, setWhere] = useState('');
  const [doc, setDoc] = useState<{ id: string; title: string } | null>(null);
  const [level, setLevel] = useState<Level>('compose');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  // The day «У щоденник» writes to (today unless another is chosen) and the month shown while choosing.
  const [dayKey, setDayKey] = useState(() => dateKey(new Date()));
  const [month, setMonth] = useState(() => new Date());
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // What was picked and not yet made into anything: thrown away when the window closes on it.
  const pending = useRef<Attachment[]>([]);
  pending.current = attachments;

  useEffect(() => {
    if (!visible) return;
    setKind(initialKind ?? 'document');
    setText('');
    setWhere(folder);
    setDoc(null);
    setLevel('compose');
    setQuery('');
    setBusy(false);
    setAttachments([]);
    setDayKey(dateKey(new Date()));
    setMonth(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => {
    if (visible) return;
    // closed: the keyboard goes with it (the field was unmounted under it and Android left it up), and whatever was
    // picked and never used is dropped (a made thing clears `attachments` first)
    Keyboard.dismiss();
    if (pending.current.length) discardAttachments(pending.current);
  }, [visible]);
  // Typing starts at once.
  useEffect(() => {
    if (!visible || level !== 'compose') return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [visible, level, kind]);
  // The phone's back goes up one step, not out of the window.
  useEffect(() => {
    if (!visible || level === 'compose') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setLevel('compose');
      setQuery('');
      return true;
    });
    return () => sub.remove();
  }, [visible, level]);
  // A keyboard's Escape (the Mac): up one step like the phone's back, and out of the window from the first step.
  useEffect(() => {
    if (!visible || typeof window === 'undefined' || !window.addEventListener) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (level === 'compose') onClose();
      else {
        setLevel('compose');
        setQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, level]);

  const styles = useMemo(() => makeStyles(S), [S]);
  const hasText = text.trim().length > 0;
  // With the text erased, pictures and files are just themselves.
  const standalone = !hasText && attachments.length > 0;
  const canAttach = kind !== 'board' && kind !== 'link';
  const needsText = !standalone && kind !== 'document';
  const canSubmit = !busy && (standalone || !needsText || hasText);
  const type = TYPES.find((t) => t.key === kind) ?? TYPES[0];

  async function submit(open: boolean) {
    if (!canSubmit) return;
    if (!standalone && kind === 'append' && !doc) {
      setLevel('doc');
      return;
    }
    setBusy(true);
    const list = attachments;
    try {
      // From here the made thing owns them: closing must not discard them.
      pending.current = [];
      setAttachments([]);
      await onSubmit(standalone ? 'files' : kind, text, where, list, { open, documentId: doc?.id, dayKey });
      onClose();
    } catch (e) {
      pending.current = list;
      setAttachments(list);
      notify('Не збереглося', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addPhoto() {
    if (!canAttach) return;
    const source = await ask({
      title: 'Додати фото',
      actions: [
        { id: 'gallery', label: 'Галерея телефону', icon: 'phone-portrait-outline' },
        { id: 'camera', label: 'Камера', icon: 'camera-outline' },
      ],
    });
    if (source !== 'gallery' && source !== 'camera') return;
    try {
      const added = await pickPhotoAttachments(source);
      if (added.length) setAttachments((prev) => [...prev, ...added]);
    } catch (e) {
      notify('Не вдалося додати', (e as Error).message);
    }
  }
  async function addFile() {
    if (!canAttach) return;
    try {
      const added = await pickFileAttachments();
      if (added.length) setAttachments((prev) => [...prev, ...added]);
    } catch (e) {
      notify('Не вдалося додати', (e as Error).message);
    }
  }
  function removeAttachment(a: Attachment) {
    setAttachments((prev) => prev.filter((x) => x.id !== a.id));
    discardAttachments([a]);
  }

  const folderLabel = where ? where.split('/').slice(-2).join(' › ') : 'Без папки';
  const baseLabel = attachments.every((a) => a.kind === 'photo') ? 'Зображення' : attachments.every((a) => a.kind === 'file') ? 'Файли' : 'свої бази';
  const chip = standalone
    ? { icon: 'folder-outline', label: where ? `У папку ${folderLabel}` : `У базу «${baseLabel}»`, fixed: false }
    : kind === 'task'
      ? tasksOnDay
        ? { icon: 'calendar-outline', label: `Справа · ${dayLabel(dayKey)}`, fixed: false }
        : { icon: 'checkbox-outline', label: 'Вхідні', fixed: true }
      : kind === 'day'
        ? { icon: 'calendar-outline', label: `Щоденник · ${dayLabel(dayKey)}`, fixed: false }
        : kind === 'append'
          ? { icon: 'document-text-outline', label: doc ? doc.title || 'Без назви' : 'Обрати нотатку', fixed: false }
          : { icon: 'folder-outline', label: folderLabel, fixed: false };
  const buttonLabel = standalone || kind === 'link' ? 'Зберегти' : kind === 'day' || kind === 'append' ? 'Додати' : 'Створити';

  const q = query.trim();
  const ql = q.toLowerCase();
  // The folder a «Нова папка» would make: inside the one you stand in.
  const newPath = q ? `${folder ? `${folder}/` : ''}${folderPathFromName(q)}` : '';
  const folderRows = useMemo(() => {
    const all = ['', ...folderPaths].filter((p, i, a) => a.indexOf(p) === i);
    const filtered = ql ? all.filter((p) => p.toLowerCase().includes(ql) || (!p && 'без папки'.includes(ql))) : all;
    // The folder you stand in comes first after the root.
    return filtered.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a === folder ? -1 : b === folder ? 1 : a.localeCompare(b)));
  }, [folderPaths, ql, folder]);
  const docRows = useMemo(() => (ql ? documents.filter((d) => (d.title || 'Без назви').toLowerCase().includes(ql)) : documents).slice(0, 60), [documents, ql]);

  let header: React.ReactNode = null;
  let body: React.ReactNode;
  let scroll = false;

  if (level === 'compose') {
    const dim = { opacity: canAttach ? 1 : 0.3 };
    body = (
      <View>
        <View style={styles.topRow}>
          <Pressable
            disabled={chip.fixed}
            onPress={() => {
              setQuery('');
              setLevel(!standalone && kind === 'append' ? 'doc' : !standalone && (kind === 'day' || (kind === 'task' && tasksOnDay)) ? 'day' : 'folder');
            }}
            style={[styles.chip, { backgroundColor: S.fill }]}
          >
            <Ionicons name={chip.icon as never} size={17} color={S.ink2} />
            <Text style={styles.chipText} numberOfLines={1}>
              {chip.label}
            </Text>
            {!chip.fixed && <Ionicons name="chevron-down" size={15} color={S.ink3} />}
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable onPress={addPhoto} hitSlop={4} accessibilityLabel="Додати фото" style={[styles.round, { backgroundColor: S.fill }, dim]}>
            <Ionicons name="image-outline" size={18} color={S.ink2} />
          </Pressable>
          <Pressable onPress={addFile} hitSlop={4} accessibilityLabel="Додати файл" style={[styles.round, { backgroundColor: S.fill }, dim]}>
            <Ionicons name="document-outline" size={18} color={S.ink2} />
          </Pressable>
          <Pressable onPress={onClose} hitSlop={4} accessibilityLabel="Закрити" style={[styles.round, { backgroundColor: S.fill }]}>
            <Ionicons name="close" size={18} color={S.ink2} />
          </Pressable>
        </View>
        <View style={styles.fieldRow}>
          {kind === 'task' && !standalone && (
            // A task starts with its checkbox, before the first letter.
            <Ionicons name="square-outline" size={24} color={S.ink3} style={styles.fieldCheck} />
          )}
          <StableTextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder={type.placeholder}
            placeholderTextColor={S.ink3}
            // No suggestion strip and no spell-check: Android underlines the word being typed for them, and that
            // line flickered under every letter (the user, 2026-10-13).
            autoCorrect={false}
            spellCheck={false}
            style={[styles.field, { flex: 1 }]}
            multiline
            textAlignVertical="top"
          />
        </View>
        {attachments.length > 0 && (
          <View style={styles.attRow}>
            {attachments.map((a) => (
              <View key={a.id} style={[styles.attChip, { backgroundColor: S.fill }]}>
                <Ionicons name={a.kind === 'photo' ? 'image-outline' : 'document-outline'} size={15} color={S.ink2} />
                <Text style={styles.attText} numberOfLines={1}>
                  {a.name}
                </Text>
                <Pressable hitSlop={8} onPress={() => removeAttachment(a)}>
                  <Ionicons name="close" size={14} color={S.ink3} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <View style={styles.bottomRow}>
          {TYPES.map((t) => {
            const on = !standalone && kind === t.key;
            return (
              <Pressable key={t.key} onPress={() => setKind(t.key)} accessibilityLabel={t.label} style={[styles.typeBtn, on && { backgroundColor: S.fillSolid }]}>
                <Ionicons name={t.icon as never} size={21} color={on ? S.ink : S.ink3} />
              </Pressable>
            );
          })}
          <View style={{ flex: 1 }} />
          {/* Nothing to make yet: a quiet grey button, not a pale orange one (that read as the dim lying over it). */}
          <Pressable onPress={() => submit(false)} disabled={!canSubmit} style={[styles.create, { backgroundColor: canSubmit ? S.accent : S.fillSolid }]}>
            <Text style={[styles.createText, !canSubmit && { color: S.ink3 }]}>{buttonLabel}</Text>
          </Pressable>
        </View>
      </View>
    );
  } else if (level === 'day') {
    // THE CALENDAR UNDER THE FIELD, the keyboard staying up (Craft's way, the user's screenshot, 2026-10-13): the text
    // can still be written while the day is chosen, and only the weeks the month really has are drawn - so it fits
    // the room the keyboard leaves, even on the cover screen. A pick returns to the compose step.
    const all = getMonthGrid(month.getFullYear(), month.getMonth());
    const weeks = Array.from({ length: 6 }, (_, w) => all.slice(w * 7, w * 7 + 7)).filter((week) => week.some((c) => c.inMonth));
    const todayKey = dateKey(new Date());
    body = (
      <View>
        <View style={styles.dayFieldRow}>
          <Pressable onPress={() => setLevel('compose')} hitSlop={8} accessibilityLabel="Назад" style={styles.stepBack}>
            <Ionicons name="chevron-back" size={22} color={S.ink} />
          </Pressable>
          <StableTextInput
            value={text}
            onChangeText={setText}
            placeholder={type.placeholder}
            placeholderTextColor={S.ink3}
            autoCorrect={false}
            spellCheck={false}
            style={styles.dayField}
            autoFocus
          />
        </View>
        <View style={styles.dayHead}>
          <Text style={styles.monthTitle}>{`${MONTH_FULL[month.getMonth()]} ${month.getFullYear()}`}</Text>
          <View style={styles.monthNav}>
            <Pressable hitSlop={6} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={22} color={S.ink2} />
            </Pressable>
            <Pressable
              hitSlop={6}
              onPress={() => {
                setMonth(new Date());
                setDayKey(todayKey);
                setLevel('compose');
              }}
              accessibilityLabel="Сьогодні"
              style={styles.navBtn}
            >
              <Ionicons name="locate" size={21} color={S.ink2} />
            </Pressable>
            <Pressable hitSlop={6} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={styles.navBtn}>
              <Ionicons name="chevron-forward" size={22} color={S.ink2} />
            </Pressable>
          </View>
        </View>
        <View style={styles.dayGrid}>
          {DAY_HEADS.map((h) => (
            <Text key={h} style={styles.dayHeadText}>
              {h}
            </Text>
          ))}
          {weeks.flat().map((c) => {
            const key = dateKey(c.date);
            const on = key === dayKey;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  setDayKey(key);
                  setLevel('compose');
                }}
                style={styles.dayCell}
              >
                <View style={[styles.dayDot, on && { backgroundColor: S.accent }]}>
                  <Text style={[styles.dayNum, !c.inMonth && { color: S.ink3 }, key === todayKey && !on && { color: S.accent, fontFamily: SOFT_SEMIBOLD }, on && { color: '#fff' }]}>{c.date.getDate()}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  } else {
    scroll = true;
    const isFolder = level === 'folder';
    header = (
      <View>
        <View style={styles.stepHead}>
          <Pressable onPress={() => setLevel('compose')} hitSlop={10} accessibilityLabel="Назад" style={styles.stepBack}>
            <Ionicons name="chevron-back" size={22} color={S.ink} />
          </Pressable>
          <Text style={styles.stepTitle}>{isFolder ? 'У яку папку' : 'До якої нотатки'}</Text>
        </View>
        <View style={[styles.search, { backgroundColor: S.fill }]}>
          <Ionicons name="search-outline" size={18} color={S.ink3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={isFolder ? 'Знайти або назвати нову папку' : 'Знайти нотатку'}
            placeholderTextColor={S.ink3}
            style={styles.searchInput}
            autoFocus
          />
        </View>
      </View>
    );
    body = isFolder ? (
      <View>
        {!!q && !folderPaths.includes(newPath) && (
          <Pressable
            onPress={() => {
              setWhere(newPath);
              setLevel('compose');
            }}
            style={styles.row}
          >
            <Ionicons name="add" size={22} color={S.accent} />
            <Text style={[styles.rowText, { color: S.accent, fontFamily: SOFT_SEMIBOLD }]} numberOfLines={1}>
              {`Нова папка «${q}»${folder ? ` у «${folder.split('/').pop()}»` : ''}`}
            </Text>
          </Pressable>
        )}
        {folderRows.map((p) => (
          <Pressable
            key={p || '__root'}
            onPress={() => {
              setWhere(p);
              setLevel('compose');
            }}
            style={styles.row}
          >
            <Ionicons name={(p ? 'folder-outline' : 'home-outline') as never} size={20} color={S.ink2} />
            <Text style={styles.rowText} numberOfLines={1}>
              {p ? p.split('/').join(' › ') : 'Без папки'}
            </Text>
            {p === where && <Ionicons name="checkmark" size={18} color={S.accent} />}
          </Pressable>
        ))}
      </View>
    ) : (
      <View>
        {docRows.map((d) => (
          <Pressable
            key={d.id}
            onPress={() => {
              setDoc(d);
              setLevel('compose');
            }}
            style={styles.row}
          >
            <Ionicons name="document-text-outline" size={20} color={S.ink2} />
            <Text style={styles.rowText} numberOfLines={1}>
              {d.title || 'Без назви'}
            </Text>
            {doc?.id === d.id && <Ionicons name="checkmark" size={18} color={S.accent} />}
          </Pressable>
        ))}
        {docRows.length === 0 && <Text style={styles.empty}>Такої нотатки нема.</Text>}
      </View>
    );
  }

  return (
    <Sheet glass={glassOn} visible={visible} onClose={onClose} handle={false} header={header} scroll={scroll} maxHeight={level === 'day' || level === 'compose' ? undefined : Math.round(windowH * 0.38)} anchor="bottom" inset={16}>
      {body}
    </Sheet>
  );
}

function makeStyles(S: ReturnType<typeof useSoft>) {
  return StyleSheet.create({
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, height: 40, borderRadius: 20, maxWidth: '62%' },
    chipText: { fontFamily: SOFT_MEDIUM, fontSize: 15, color: S.ink, flexShrink: 1 },
    round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    fieldRow: { flexDirection: 'row', alignItems: 'flex-start' },
    fieldCheck: { marginTop: 13, marginRight: 8, marginLeft: 4 },
    dayFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
    dayField: { flex: 1, height: 46, fontFamily: SOFT_REGULAR, fontSize: 18, color: S.ink, paddingVertical: 0 },
    dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
    monthTitle: { fontFamily: SOFT_SEMIBOLD, fontSize: 18, color: S.ink, marginLeft: 4 },
    monthNav: { flexDirection: 'row', alignItems: 'center' },
    navBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    dayDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    dayCell: { width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center' },
    dayNum: { fontFamily: SOFT_REGULAR, fontSize: 16, color: S.ink },
    dayHeadText: { width: `${100 / 7}%`, textAlign: 'center', fontFamily: SOFT_MEDIUM, fontSize: 12.5, color: S.ink3, paddingVertical: 4 },
    field: { minHeight: 72, maxHeight: 200, fontFamily: SOFT_REGULAR, fontSize: 19, color: S.ink, paddingTop: 10, paddingBottom: 6, paddingHorizontal: 4 },
    attRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    attChip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 15, maxWidth: '100%' },
    attText: { fontFamily: SOFT_REGULAR, fontSize: 14, color: S.ink, flexShrink: 1 },
    bottomRow: { flexDirection: 'row', alignItems: 'center' },
    typeBtn: { width: 41, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    create: { height: 44, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
    createText: { fontFamily: SOFT_SEMIBOLD, fontSize: 15.5, color: '#fff' },
    stepHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
    stepBack: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
    stepTitle: { fontFamily: SOFT_SEMIBOLD, fontSize: 18, color: S.ink },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 42, borderRadius: 21, marginBottom: 6 },
    searchInput: { flex: 1, fontFamily: SOFT_REGULAR, fontSize: 16, color: S.ink, paddingVertical: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 4 },
    rowText: { flex: 1, fontFamily: SOFT_REGULAR, fontSize: 17, color: S.ink },
    empty: { fontFamily: SOFT_REGULAR, fontSize: 15, color: S.ink3, paddingVertical: 18, textAlign: 'center' },
  });
}
