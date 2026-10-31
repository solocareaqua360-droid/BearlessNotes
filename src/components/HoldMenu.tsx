import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NO_WINDOW_DRAG } from '../utils/windowDrag';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, SlideInLeft, SlideInRight, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { GlassPortal } from './GlassPortal';
import { useBlurTarget } from './GlassTarget';
import { Ionicons } from './icons/Ionicons';
import SoftIcon from './SoftIcon';
import DockGlassFill, { useDockSurface } from './DockGlassFill';
import { useDockGlass } from '../utils/dockGlass';
import { useSoft } from '../theme/soft';
import { RELEASE_ANYWHERE, STILL_PANEL } from './surfaces/Menu';
import { SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';

// SOMETHING HELD - the chat's gesture (ChatMessageMenu), for anything
// else: everything goes out of focus behind a blur, the thing itself
// stays sharp, lifted a little, and what can be done to it opens beside
// it. A step that needs a choice turns the card over to a page of its own
// with a way back, never a second window; a dangerous row asks once more
// in its own place. First for a folder (2026-10-02), in the list and on
// the canvas alike.

export type HoldAction = {
  key: string;
  label: string;
  icon: string;
  onPress?: () => void;
  // Turns the card to a page of choices instead of acting.
  page?: HoldPage;
  tone?: 'danger';
  confirmLabel?: string;
};

// A page of choices that can be switched on and off - the databases a
// folder lives in. `locked`: on, and not to be switched off here (it
// holds something there - see the folders' lines for how that is undone).
export type HoldPage = {
  title: string;
  options: { key: string; label: string; icon: string; color: string; on: boolean; locked?: string }[];
  onToggle: (key: string) => void;
};

const ROW_H = 48;
const MENU_W = 272;
const GAP = 12;
const DANGER = (dark: boolean) => (dark ? '#FF7A6E' : '#C8452F');

export default function HoldMenu({
  anchor,
  card,
  actions,
  onClose,
}: {
  // Where the held thing stands on screen, or null: closed.
  anchor: { x: number; y: number; width: number; height: number } | null;
  card: ReactNode;
  actions: HoldAction[];
  onClose: () => void;
}) {
  const S = useSoft();
  const { width: windowW, height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<HoldPage | null>(null);
  const [pageKey, setPageKey] = useState<string | null>(null);
  const [forward, setForward] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!anchor) return;
    setPage(null);
    setPageKey(null);
    setConfirming(null);
  }, [anchor]);
  // A page reads its options live from the action that opened it.
  const livePage = pageKey ? actions.find((a) => a.key === pageKey)?.page ?? page : null;

  const rows = livePage ? livePage.options.length + 1 : actions.length;
  const menuH = Math.min(rows * ROW_H + 16, Math.round(windowH * 0.55));

  const place = useMemo(() => {
    if (!anchor) return null;
    const top = insets.top + 16;
    const bottom = windowH - insets.bottom - 16;
    const cardH = Math.min(anchor.height, Math.round(windowH * 0.3));
    let cardTop = anchor.y;
    let menuTop: number;
    if (anchor.y + cardH + GAP + menuH <= bottom) {
      menuTop = anchor.y + cardH + GAP;
    } else if (anchor.y - GAP - menuH >= top && anchor.y + cardH <= bottom) {
      menuTop = anchor.y - GAP - menuH;
    } else {
      cardTop = Math.max(top, bottom - menuH - GAP - cardH);
      menuTop = cardTop + cardH + GAP;
    }
    const menuLeft = Math.max(16, Math.min(anchor.x + anchor.width - MENU_W, windowW - MENU_W - 16));
    return { cardTop, cardH, menuTop, menuLeft };
  }, [anchor, menuH, windowH, windowW, insets.top, insets.bottom]);

  const progress = useSharedValue(0);
  const closing = useSharedValue(0);
  // The menu's own growth, out of the corner nearest the card, on the soft spring every Menu uses (the four windows,
  // 2026-10-25: «меню виростає з об'єкта») - the card keeps its timed lift.
  const grow = useSharedValue(0);
  // Still: the spring has come to rest and the menu wears a plain full-size style - the same dead-press cure as
  // surfaces/Menu («DEAD PRESSES WHILE IT GROWS»): React never sees the UI-thread scale, so until then a held press was
  // measured against the quarter-size menu and dropped.
  const [still, setStill] = useState(false);
  useEffect(() => {
    if (!anchor) return;
    setStill(false);
    closing.value = 0;
    progress.value = 0;
    grow.value = 0;
    progress.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
    grow.value = withSpring(1, { damping: 20, stiffness: 300, mass: 0.7, energyThreshold: 1e-4 }, (finished) => {
      if (finished) runOnJS(setStill)(true);
    });
  }, [anchor, progress, closing, grow]);
  const travel = anchor && place ? anchor.y - place.cardTop : 0;
  const menuBelow = anchor && place ? place.menuTop > place.cardTop : true;
  const cardMotion = useAnimatedStyle(() => ({
    transform: [{ translateY: travel * (1 - progress.value) }, { scale: 1 + 0.03 * progress.value }],
  }));
  const menuMotion = useAnimatedStyle(() => ({
    opacity: Math.min(1, grow.value * 2),
    transform: [{ scale: 0.25 + 0.75 * grow.value }],
  }));
  const dimMotion = useAnimatedStyle(() => ({ opacity: progress.value }));
  const close = () => {
    if (closing.value) return;
    closing.value = 1;
    setStill(false);
    grow.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) });
    progress.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(onClose)();
    });
  };

  const blurTarget = useBlurTarget();
  // The menu is glass too, like every other menu (surfaces/Menu): a blur of the app under the blur behind - it was left
  // white (the user, 2026-10-25: «меню папки досі біле»). The chat capsule's `dense` milk: what is behind is a smear already, but a dark card there still greyed the rows.
  const glassOn = useDockGlass();
  const glassSurface = useDockSurface(S, glassOn);
  useEffect(() => {
    if (!anchor) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pageKey) {
        setForward(false);
        setPageKey(null);
        setPage(null);
      } else close();
      return true;
    });
    return () => sub.remove();
  });

  if (!anchor || !place) return null;

  const row = (key: string, icon: ReactNode, label: string, onPress: () => void, opts: { danger?: boolean; trailing?: ReactNode; strong?: boolean; dim?: boolean } = {}) => (
    <Pressable key={key} onPress={onPress} pressRetentionOffset={RELEASE_ANYWHERE} style={({ pressed }) => [styles.row, pressed && { backgroundColor: S.fill }]}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text
        style={[
          styles.rowLabel,
          { color: opts.danger ? DANGER(S.dark) : opts.dim ? S.ink3 : S.ink },
          opts.strong && { fontFamily: SOFT_SEMIBOLD },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {opts.trailing}
    </Pressable>
  );
  const icon = (name: string, color = S.ink2) => <Ionicons name={name as never} size={20} color={color} />;

  let content: ReactNode;
  if (livePage) {
    content = (
      <>
        {row('back', <SoftIcon name="back" size={18} color={S.ink2} />, livePage.title, () => {
          setForward(false);
          setPageKey(null);
          setPage(null);
        }, { strong: true })}
        {livePage.options.map((o) =>
          row(o.key, icon(o.icon, o.color), o.locked ? `${o.label} · ${o.locked}` : o.label, () => {
            if (!o.locked) livePage.onToggle(o.key);
          }, {
            dim: !!o.locked,
            trailing: o.on ? <Ionicons name="checkmark" size={18} color={o.locked ? S.ink3 : S.accent} /> : undefined,
          })
        )}
      </>
    );
  } else {
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
            setForward(true);
            setPage(action.page);
            setPageKey(action.key);
          } else if (action.confirmLabel) setConfirming(action.key);
          else {
            action.onPress?.();
            close();
          }
        },
        { danger: action.tone === 'danger', trailing: action.page ? <SoftIcon name="forward" size={16} color={S.ink3} /> : undefined }
      );
    });
  }

  return (
    <GlassPortal name="HoldMenu">
      <View style={[styles.layer, NO_WINDOW_DRAG]}>
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
        <Animated.View
          pointerEvents="none"
          style={[
            styles.lifted,
            { top: place.cardTop, left: anchor.x, width: anchor.width, maxHeight: place.cardH, borderRadius: 20, boxShadow: S.popShadow },
            cardMotion,
          ]}
        >
          {card}
        </Animated.View>
        <Animated.View
          style={[
            styles.menu,
            {
              top: place.menuTop,
              left: place.menuLeft,
              width: MENU_W,
              maxHeight: menuH,
              ...(glassOn ? {} : { backgroundColor: S.card, boxShadow: S.popShadow }),
              transformOrigin: menuBelow ? 'right top' : 'right bottom',
            },
            glassOn && glassSurface,
            still ? STILL_PANEL : menuMotion,
          ]}
        >
          {glassOn && <DockGlassFill soft={S} radius={24} dense />}
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Animated.View key={pageKey ?? 'root'} entering={(forward ? SlideInRight : SlideInLeft).duration(200)}>
              {content}
            </Animated.View>
          </ScrollView>
        </Animated.View>
      </View>
    </GlassPortal>
  );
}

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
  menu: {
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
});
