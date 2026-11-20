import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Sheet from './surfaces/Sheet';
import AttachmentImage from './AttachmentImage';
import { Ionicons } from './icons/Ionicons';
import { confirm, notify } from './surfaces/Ask';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { OLD_MONTHS, deletePageImages, isOld, putPageImageIntoBase, scanPageImages, type PageImage } from '../utils/pageImages';

// «КАРТИНКИ НА СТОРІНКАХ» - the pictures that live on a page only (the one rule), seen in one list so they can be cleaned: by where they
// are (calendar days, notes, boards), oldest first, with what each takes on the Drive. One tap puts one into the base or deletes it; one
// button takes off everything older than half a year in the shown part - always after a window that says how many and how much.
type Part = 'all' | 'day' | 'note' | 'board';
const PARTS: { key: Part; label: string }[] = [
  { key: 'all', label: 'Усі' },
  { key: 'day', label: 'Аркуші календаря' },
  { key: 'note', label: 'Нотатки' },
  { key: 'board', label: 'Дошки' },
];

const mb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`);
const dateLabel = (ms: number) => (ms ? new Date(ms).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function PageImagesCleanup({ visible, onClose, onOpenPage }: { visible: boolean; onClose: () => void; onOpenPage?: (img: PageImage) => void }) {
  const S = useSoft();
  const [items, setItems] = useState<PageImage[] | null>(null);
  const [part, setPart] = useState<Part>('all');
  const [busy, setBusy] = useState(false);

  function load() {
    setItems(null);
    scanPageImages()
      .then(setItems)
      .catch((e) => {
        setItems([]);
        notify('Не вдалося прочитати', (e as Error).message);
      });
  }
  useEffect(() => {
    if (visible) load();
  }, [visible]);

  const shown = useMemo(() => (items ?? []).filter((i) => part === 'all' || i.where === part), [items, part]);
  const old = useMemo(() => shown.filter((i) => isOld(i)), [shown]);
  const sum = (list: PageImage[]) => list.reduce((n, i) => n + (i.bytes ?? 0), 0);

  async function remove(list: PageImage[], title: string) {
    if (list.length === 0 || busy) return;
    const size = sum(list);
    const yes = await confirm({
      title,
      message: `Картинки зникнуть зі сторінок назавжди${size ? `, разом з копіями на Диску (${mb(size)})` : ''}. Повернути їх не можна.`,
      confirmLabel: 'Видалити',
    });
    if (!yes) return;
    setBusy(true);
    try {
      const { removed, driveFailed } = await deletePageImages(list);
      notify('Видалено', `Картинок: ${removed}${driveFailed ? `. З Диска не вдалося прибрати: ${driveFailed}` : ''}.`);
      load();
    } catch (e) {
      notify('Не вдалося видалити', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function intoBase(i: PageImage) {
    try {
      await putPageImageIntoBase(i);
      setItems((prev) => (prev ?? []).filter((x) => x.key !== i.key));
    } catch (e) {
      notify('Не вдалося', (e as Error).message);
    }
  }

  const total = sum(items ?? []);
  return (
    <Sheet visible={visible} onClose={onClose} title="Картинки на сторінках" subtitle={items ? `${items.length} шт.${total ? ` · ${mb(total)} на Диску` : ''}` : 'Читаю сторінки…'} scroll maxHeight="88%">
      <View style={styles.parts}>
        {PARTS.map((p) => (
          <Pressable key={p.key} onPress={() => setPart(p.key)} style={[styles.chip, { backgroundColor: part === p.key ? S.ink : S.fill }]}>
            <Text style={[styles.chipText, { color: part === p.key ? S.card : S.ink2 }]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      {old.length > 0 && (
        <Pressable onPress={() => remove(old, `Видалити старші за ${OLD_MONTHS} місяців: ${old.length}?`)} style={[styles.bulk, { backgroundColor: S.fill }]}>
          <Ionicons name="trash-outline" size={17} color="#B3412E" />
          <Text style={[styles.bulkText, { color: '#B3412E' }]}>
            Видалити старші за {OLD_MONTHS} місяців · {old.length}
            {sum(old) ? ` · ${mb(sum(old))}` : ''}
          </Text>
        </Pressable>
      )}
      {items && shown.length === 0 && <Text style={[styles.empty, { color: S.ink3 }]}>Тут нічого немає.</Text>}
      {shown.map((i) => (
        <View key={i.key} style={styles.row}>
          <Pressable style={styles.thumb} onPress={() => onOpenPage?.(i)}>
            <AttachmentImage uri={i.uri} driveFileId={i.driveFileId} style={StyleSheet.absoluteFill} />
          </Pressable>
          <Pressable style={styles.info} onPress={() => onOpenPage?.(i)}>
            <Text numberOfLines={1} style={[styles.title, { color: S.ink }]}>
              {i.where === 'day' ? `Аркуш ${i.title}` : i.where === 'board' ? `Дошка «${i.title}»` : i.title}
            </Text>
            <Text style={[styles.meta, { color: isOld(i) ? '#B3412E' : S.ink3 }]}>
              {dateLabel(i.at)}
              {i.bytes ? ` · ${mb(i.bytes)}` : ''}
            </Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => intoBase(i)} accessibilityLabel="У базу зображень" style={styles.act}>
            <Ionicons name="server-outline" size={19} color={S.ink2} />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => remove([i], 'Видалити картинку зі сторінки?')} accessibilityLabel="Видалити" style={styles.act}>
            <Ionicons name="trash-outline" size={19} color="#B3412E" />
          </Pressable>
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  parts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { borderRadius: 999, paddingHorizontal: 12, height: 30, justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: SOFT_SEMIBOLD },
  bulk: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 14, height: 44, marginBottom: 10 },
  bulkText: { fontSize: 14, fontFamily: SOFT_SEMIBOLD, flexShrink: 1 },
  empty: { fontSize: 14, fontFamily: SOFT_REGULAR, paddingVertical: 24, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  thumb: { width: 52, height: 52, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.06)' },
  info: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontFamily: SOFT_MEDIUM },
  meta: { fontSize: 12.5, fontFamily: SOFT_REGULAR, marginTop: 2 },
  act: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
