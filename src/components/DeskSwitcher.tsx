import { useEffect, useRef } from 'react';
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassPortal } from './GlassPortal';
import { useBlurTarget } from './GlassTarget';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM } from '../utils/fonts';

// THE OPEN DESKS, as a browser shows its tabs (the user's design,
// 2026-10-03): a tap on any desk of the bar opens this - every open desk as
// a card with its picture, in a row that scrolls sideways like the start
// desk's cards. A tap on a card goes to that desk; the cross closes it.
export type SwitcherDesk = {
  key: string;
  label: string;
  icon: string;
  active: boolean;
  shot?: string;
  onPick: () => void;
  onClose?: () => void;
};

const GAP = 14;

export default function DeskSwitcher({
  visible,
  desks,
  onDismiss,
}: {
  visible: boolean;
  desks: SwitcherDesk[];
  onDismiss: () => void;
}) {
  const S = useSoft();
  const { width, height } = useWindowDimensions();
  const blurTarget = useBlurTarget();
  const scroll = useRef<ScrollView>(null);
  const cardW = Math.min(230, Math.round(width * 0.54));
  // The picture has the window's own shape, cut to a size that fits.
  const picH = Math.min(Math.round((cardW * height) / width), Math.round(height * 0.55));
  const activeIndex = Math.max(0, desks.findIndex((d) => d.active));

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [visible, onDismiss]);
  // Opens on the desk in front.
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => scroll.current?.scrollTo({ x: activeIndex * (cardW + GAP), animated: false }), 30);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;
  return (
    <GlassPortal priority={50}>
      <View style={styles.layer}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <BlurView
            intensity={40}
            tint={S.dark ? 'dark' : 'light'}
            blurMethod="dimezisBlurView"
            blurTarget={blurTarget ?? undefined}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: S.dark ? 'rgba(0,0,0,0.4)' : 'rgba(30,30,28,0.14)' }]} />
        </View>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <ScrollView
          ref={scroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.scroll}
          contentContainerStyle={{ paddingHorizontal: Math.round((width - cardW) / 2), gap: GAP, alignItems: 'center' }}
          snapToInterval={cardW + GAP}
          decelerationRate="fast"
        >
          {desks.map((desk) => (
            <Pressable
              key={desk.key}
              onPress={desk.onPick}
              style={({ pressed }) => [
                styles.card,
                {
                  width: cardW,
                  backgroundColor: S.card,
                  boxShadow: S.popShadow,
                  borderColor: desk.active ? S.ink : 'transparent',
                },
                pressed && { opacity: 0.8 },
              ]}
            >
              <View style={styles.head}>
                <Ionicons name={desk.icon as never} size={16} color={S.ink2} />
                <Text style={[styles.title, { color: S.ink }]} numberOfLines={1}>
                  {desk.label}
                </Text>
                {desk.onClose && (
                  <Pressable hitSlop={10} onPress={desk.onClose} accessibilityLabel="Закрити стіл" style={styles.close}>
                    <Ionicons name="close" size={17} color={S.ink2} />
                  </Pressable>
                )}
              </View>
              <View style={[styles.picture, { height: picH, backgroundColor: S.fill }]}>
                {desk.shot ? (
                  <Image source={{ uri: desk.shot }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <Ionicons name={desk.icon as never} size={44} color={S.ink3} />
                )}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  card: { borderRadius: 24, borderWidth: 2, overflow: 'hidden' },
  head: { height: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 8 },
  title: { flex: 1, fontSize: 14, fontFamily: SOFT_MEDIUM },
  close: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  picture: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
