import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, SlideInLeft, SlideInRight, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { GlassPortal } from './GlassPortal';
import { useBlurTarget } from './GlassTarget';
import { Ionicons } from './icons/Ionicons';
import SoftIcon from './SoftIcon';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';

// A MESSAGE HELD: everything else goes out of focus behind a blur, the
// message itself stays sharp, lifted a little, and what can be done to
// it opens beside it - the messenger's gesture, in this app's soft style
// (the user's own reference, 2026-09-29).
//
// And it never opens a second window. An action that needs a second step
// ("У проект" - which project; "У нотатку" - which note) turns THIS card
// over to that step, with a way back at its top - "далі може бути нове
// вікно з вибором проектів і це руйнує всю схему". The blur, the lifted
// message and the card stay put throughout.

export type ChatMenuAction = {
  key: string;
  label: string;
  icon: string;
  onPress?: () => void;
  // Turns the card to one of its own pages instead of acting.
  page?: 'projects' | 'notes';
  tone?: 'danger';
  // Danger actions ask once more IN the card (the row turns into its own
  // confirmation) rather than through another window.
  confirmLabel?: string;
};

type Page = 'root' | 'projects' | 'notes' | 'newProject' | 'newNote';

const ROW_H = 48;
const MENU_W = 272;
const GAP = 12;

export default function ChatMessageMenu({
  anchor,
  bubble,
  actions,
  projects,
  onToggleProject,
  onNewProject,
  recentNotes,
  onLoadNotes,
  onToToday,
  onToNewNote,
  onToNote,
  newNoteDefault,
  onClose,
}: {
  // Where the message stands on screen (measureInWindow), or null: closed.
  anchor: { x: number; y: number; width: number; height: number } | null;
  bubble: ReactNode;
  actions: ChatMenuAction[];
  projects: { id: string; name: string; color: string; on: boolean }[];
  onToggleProject: (id: string) => void;
  onNewProject: (name: string) => void;
  recentNotes: { id: string; title: string }[] | null;
  onLoadNotes: () => void;
  onToToday: () => void;
  onToNewNote: (title: string) => void;
  onToNote: (id: string, title: string) => void;
  newNoteDefault: string;
  onClose: () => void;
}) {
  const S = useSoft();
  const { width: windowW, height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<Page>('root');
  const [forward, setForward] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!anchor) return;
    setPage('root');
    setConfirming(null);
    setQuery('');
  }, [anchor]);

  const go = (next: Page, isForward = true) => {
    setForward(isForward);
    setPage(next);
  };

  // How tall the card is on each page - worked out, not measured, so the
  // message and the card are placed in the first frame.
  const rows =
    page === 'root'
      ? actions.length
      : page === 'projects'
        ? projects.length + 2
        : page === 'notes'
          ? Math.min(8, (recentNotes?.length ?? 0)) + 4
          : 3;
  const menuH = Math.min(rows * ROW_H + 16, Math.round(windowH * 0.5));

  const place = useMemo(() => {
    if (!anchor) return null;
    const top = insets.top + 16;
    const bottom = windowH - insets.bottom - 16;
    const bubbleH = Math.min(anchor.height, Math.round(windowH * 0.42));
    let bubbleTop = anchor.y;
    let menuTop: number;
    if (anchor.y + bubbleH + GAP + menuH <= bottom) {
      menuTop = anchor.y + bubbleH + GAP;
    } else if (anchor.y - GAP - menuH >= top && anchor.y + bubbleH <= bottom) {
      menuTop = anchor.y - GAP - menuH;
    } else {
      // Neither fits where the message is: the message moves up just
      // enough for the card to stand under it.
      bubbleTop = Math.max(top, bottom - menuH - GAP - bubbleH);
      menuTop = bubbleTop + bubbleH + GAP;
    }
    const menuLeft = Math.max(16, Math.min(anchor.x + anchor.width - MENU_W, windowW - MENU_W - 16));
    return { bubbleTop, bubbleH, menuTop, menuLeft };
  }, [anchor, menuH, windowH, windowW, insets.top, insets.bottom]);

  // THE MOTION (the user's call: "зараз це ривок"). One progress, 0 -> 1:
  // the message glides from where it stood to where it is shown and comes
  // a touch forward; the card grows out of the corner nearest the message
  // to its own size; the dim comes up with them. Closing runs it back
  // before anything is taken away.
  const progress = useSharedValue(0);
  const closing = useSharedValue(0);
  useEffect(() => {
    if (!anchor) return;
    closing.value = 0;
    progress.value = 0;
    progress.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
  }, [anchor, progress, closing]);
  const travel = anchor && place ? anchor.y - place.bubbleTop : 0;
  const menuBelow = anchor && place ? place.menuTop > place.bubbleTop : true;
  const bubbleMotion = useAnimatedStyle(() => ({
    transform: [{ translateY: travel * (1 - progress.value) }, { scale: 1 + 0.02 * progress.value }],
  }));
  const menuMotion = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 1.6),
    transform: [{ scale: 0.55 + 0.45 * progress.value }],
  }));
  const dimMotion = useAnimatedStyle(() => ({ opacity: progress.value }));
  const close = () => {
    if (closing.value) return;
    closing.value = 1;
    progress.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(onClose)();
    });
  };

  const blurTarget = useBlurTarget();
  useEffect(() => {
    if (!anchor) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  });

  if (!anchor || !place) return null;

  const row = (key: string, icon: ReactNode, label: string, onPress: () => void, opts: { danger?: boolean; trailing?: ReactNode; strong?: boolean } = {}) => (
    <Pressable key={key} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: S.fill }]}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text
        style={[styles.rowLabel, { color: opts.danger ? DANGER(S.dark) : S.ink }, opts.strong && { fontFamily: SOFT_SEMIBOLD }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {opts.trailing}
    </Pressable>
  );
  const icon = (name: string, color = S.ink2) => <Ionicons name={name as never} size={20} color={color} />;
  const chevron = <SoftIcon name="forward" size={16} color={S.ink3} />;
  const back = (to: Page = 'root') =>
    row('back', <SoftIcon name="back" size={18} color={S.ink2} />, 'Назад', () => go(to, false), { strong: true });

  let content: ReactNode;
  if (page === 'root') {
    content = actions.map((action) => {
      if (confirming === action.key) {
        return row(action.key, icon(action.icon, DANGER(S.dark)), action.confirmLabel ?? 'Точно?', () => {
          action.onPress?.();
          close();
        }, { danger: true, strong: true });
      }
      return row(
        action.key,
        icon(action.icon, action.tone === 'danger' ? DANGER(S.dark) : S.ink2),
        action.label,
        () => {
          if (action.page) {
            if (action.page === 'notes') onLoadNotes();
            go(action.page);
          } else if (action.confirmLabel) setConfirming(action.key);
          else {
            action.onPress?.();
            close();
          }
        },
        { danger: action.tone === 'danger', trailing: action.page ? chevron : undefined }
      );
    });
  } else if (page === 'projects') {
    content = (
      <>
        {back()}
        {projects.map((p) =>
          row(
            p.id,
            <View style={[styles.dot, { backgroundColor: p.color }]} />,
            p.name,
            () => onToggleProject(p.id),
            { trailing: p.on ? <Ionicons name="checkmark" size={18} color={S.accent} /> : undefined }
          )
        )}
        {row('new', icon('add'), 'Новий проект', () => {
          setDraft('');
          go('newProject');
        })}
      </>
    );
  } else if (page === 'notes') {
    const needle = query.trim().toLowerCase();
    const shown = (recentNotes ?? []).filter((n) => !needle || n.title.toLowerCase().includes(needle)).slice(0, 8);
    content = (
      <>
        {back()}
        {row('today', icon('today-outline'), 'Сьогоднішня нотатка', () => {
          onToToday();
          close();
        })}
        {row('new', icon('add'), 'Нова нотатка', () => {
          setDraft(newNoteDefault);
          go('newNote');
        })}
        <View style={[styles.search, { backgroundColor: S.fill }]}>
          <SoftIcon name="search" size={16} color={S.ink3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Знайти нотатку"
            placeholderTextColor={S.ink3}
            style={[styles.searchInput, { color: S.ink }]}
          />
        </View>
        {recentNotes === null ? (
          <Text style={[styles.hint, { color: S.ink3 }]}>Завантажую…</Text>
        ) : (
          shown.map((n) =>
            row(n.id, icon('document-text-outline'), n.title || 'Без назви', () => {
              onToNote(n.id, n.title);
              close();
            })
          )
        )}
      </>
    );
  } else {
    const isProject = page === 'newProject';
    const submit = () => {
      const name = draft.trim();
      if (!name) return;
      if (isProject) {
        onNewProject(name);
        go('projects', false);
      } else {
        onToNewNote(name);
        close();
      }
    };
    content = (
      <>
        {back(isProject ? 'projects' : 'notes')}
        <View style={[styles.search, { backgroundColor: S.fill }]}>
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            placeholder={isProject ? 'Назва проекту' : 'Назва нотатки'}
            placeholderTextColor={S.ink3}
            style={[styles.searchInput, { color: S.ink }]}
          />
        </View>
        {row('ok', icon('checkmark', S.accent), isProject ? 'Створити проект' : 'Створити нотатку', submit, { strong: true })}
      </>
    );
  }

  return (
    <GlassPortal>
      <View style={styles.layer}>
        {/* The blur fades in with everything else - in the ground's own
            tone, light over a light screen - rather than dropping in dark. */}
        <Animated.View style={[StyleSheet.absoluteFill, dimMotion]} pointerEvents="none">
          <BlurView
            intensity={40}
            tint={S.dark ? 'dark' : 'light'}
            blurMethod="dimezisBlurView"
            blurTarget={blurTarget ?? undefined}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: S.dark ? 'rgba(0,0,0,0.35)' : 'rgba(30,30,28,0.08)' }]} />
        </Animated.View>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        {/* The message, sharp above the blur, a touch forward. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.lifted,
            {
              top: place.bubbleTop,
              left: anchor.x,
              width: anchor.width,
              maxHeight: place.bubbleH,
              borderRadius: 20,
              boxShadow: S.popShadow,
            },
            bubbleMotion,
          ]}
        >
          {bubble}
        </Animated.View>
        <Animated.View
          style={[
            styles.card,
            {
              top: place.menuTop,
              left: place.menuLeft,
              width: MENU_W,
              maxHeight: menuH,
              backgroundColor: S.card,
              boxShadow: S.popShadow,
              // Grows out of the corner that faces the message.
              transformOrigin: menuBelow ? 'right top' : 'right bottom',
            },
            menuMotion,
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Animated.View key={page} entering={(forward ? SlideInRight : SlideInLeft).duration(200)}>
              {content}
            </Animated.View>
          </ScrollView>
        </Animated.View>
      </View>
    </GlassPortal>
  );
}

const DANGER = (dark: boolean) => (dark ? '#FF7A6E' : '#C8452F');

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 50,
  },
  lifted: {
    position: 'absolute',
    overflow: 'hidden',
  },
  card: {
    position: 'absolute',
    borderRadius: 24,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  rowIcon: {
    width: 22,
    alignItems: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    fontFamily: SOFT_REGULAR,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    marginHorizontal: 12,
    marginVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: SOFT_REGULAR,
    paddingVertical: 0,
  },
  hint: {
    fontSize: 13,
    fontFamily: SOFT_MEDIUM,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
