import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import { Ionicons } from './icons/Ionicons';
import { useSoft, type SoftTokens } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import { dateKey } from '../utils/dateLocale';
import { groupAppliesTo } from '../utils/groups';
import { isDueToday, isOverdue } from '../utils/taskViews';
import { toggleTaskEverywhere, type ToggleableTask } from '../utils/taskToggle';
import type { Group } from '../types';

// THE DAY'S TASKS AT THE TOP OF ITS NOTE (2026-10-12, step 3 of the Craft-like calendar). A task made for a day
// is already a checkbox in that day's note, so it is not drawn twice: this block holds the day's tasks that live
// ELSEWHERE - set for this date in another note, starred for it - and, on today's note, what is still open from
// the days before. Live: a tick here ticks the task everywhere. A tap on a task opens the note it lives in. With
// nothing to hold the block is not drawn at all.
type BlockTask = ToggleableTask & { todayMarkedDate?: string };

export default function DayTasksBlock({
  dayKey,
  documentId,
  onOpenDocument,
}: {
  dayKey: string;
  documentId: string;
  onOpenDocument: (id: string) => void;
}) {
  const S = useSoft();
  const styles = useMemo(() => makeStyles(S), [S]);
  const [tasks, setTasks] = useState<BlockTask[]>([]);
  const [groups, setGroups] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState(true);
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('tasks'),
        (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BlockTask, 'id'>) }))),
        listenError('DayTasksBlock:tasks')
      ),
    []
  );
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('groups'),
        (snap) => {
          const next = new Map<string, string>();
          snap.docs.forEach((d) => {
            const g = { id: d.id, ...d.data() } as Group;
            if (groupAppliesTo(g, 'task')) next.set(d.id, g.name);
          });
          setGroups(next);
        },
        listenError('DayTasksBlock:groups')
      ),
    []
  );
  const todayKey = dateKey(new Date());
  const shown = useMemo(() => {
    const mine = tasks.filter((t) => {
      if (t.documentId === documentId) return false;
      if (t.todayMarkedDate === dayKey || t.reminderDate === dayKey) return true;
      return dayKey === todayKey && !t.checked && isDueToday(t, todayKey) && isOverdue(t, todayKey);
    });
    return [...mine.filter((t) => !t.checked), ...mine.filter((t) => t.checked)];
  }, [tasks, documentId, dayKey, todayKey]);
  if (shown.length === 0) return null;
  const left = shown.filter((t) => !t.checked).length;
  return (
    <View style={styles.block}>
      <Pressable style={styles.head} onPress={() => setOpen((v) => !v)} hitSlop={6}>
        <Text style={styles.title}>Справи</Text>
        <Text style={styles.count}>{left > 0 ? left : '✓'}</Text>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={20} color={S.ink3} style={styles.chevron} />
      </Pressable>
      {open &&
        shown.map((t) => (
          <View key={t.id} style={styles.task}>
            <Pressable hitSlop={10} onPress={() => toggleTaskEverywhere(t)} accessibilityLabel={t.checked ? 'Зняти позначку' : 'Позначити зробленим'}>
              <View style={[styles.box, t.checked && { backgroundColor: S.ink3, borderColor: S.ink3 }]}>
                {t.checked && <Ionicons name="checkmark" size={14} color={S.card} />}
              </View>
            </Pressable>
            <Pressable style={styles.textWrap} onPress={() => t.documentId && onOpenDocument(t.documentId)}>
              <Text style={[styles.text, t.checked && styles.done]} numberOfLines={1}>
                {t.text || 'Без назви'}
              </Text>
            </Pressable>
            <Text style={styles.chip} numberOfLines={1}>
              {(t.groupId && groups.get(t.groupId)) || 'Вхідні'}
            </Text>
            {!!t.reminderTime && <Ionicons name="alarm-outline" size={16} color={S.ink3} />}
          </View>
        ))}
    </View>
  );
}

function makeStyles(S: SoftTokens) {
  return StyleSheet.create({
    block: { backgroundColor: S.fill, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 16, marginBottom: 14 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 34 },
    title: { fontFamily: SOFT_SEMIBOLD, fontSize: 17, color: S.ink },
    count: { fontFamily: SOFT_MEDIUM, fontSize: 14, color: S.ink3 },
    chevron: { marginLeft: 'auto' },
    task: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 40 },
    box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.8, borderColor: S.ink3, alignItems: 'center', justifyContent: 'center' },
    textWrap: { flex: 1, minWidth: 0 },
    text: { fontFamily: SOFT_MEDIUM, fontSize: 16, color: S.ink },
    done: { color: S.ink3, textDecorationLine: 'line-through' },
    chip: { maxWidth: 110, fontFamily: SOFT_MEDIUM, fontSize: 13, color: S.ink2, backgroundColor: S.card, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  });
}
