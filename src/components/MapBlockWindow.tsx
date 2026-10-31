import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from './icons/Ionicons';
import GeoMapView, { type GeoMapPoint } from './GeoMapView';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';

// A MAP BLOCK IN A NOTE, LIVE (2026-10-28, sketch NhS6SVqj1GGGYdsZPYwP7K, the user: «до моменту редагування він повністю
// заморожений картинка, при натисканні все інше в документі завмирає, починається робота з мапою»). The block itself
// is a picture; a tap opens this window over the note - the note stands still under it - with the live map where the
// picture was taken, the geo points, the ruler and «Знімок». A new snapshot replaces the block's picture (the user:
// «новий замінює старий»); «Готово» just closes.
export type MapShot = { uri: string; view: { lat: number; lng: number; zoom: number } };

export default function MapBlockWindow({
  visible,
  start,
  onShot,
  onClose,
}: {
  visible: boolean;
  start: { lat: number; lng: number; zoom: number } | null;
  onShot: (shot: MapShot) => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const [points, setPoints] = useState<GeoMapPoint[]>([]);
  const [rulerOn, setRulerOn] = useState(false);
  const snapshotRef = useRef<(() => Promise<string | null>) | null>(null);
  const viewRef = useRef<(() => { lat: number; lng: number; zoom: number }) | null>(null);
  const [busy, setBusy] = useState(false);

  // The geo points, read only while the window is open.
  useEffect(() => {
    if (!visible) return;
    setRulerOn(false);
    return onSnapshot(
      ownedQuery('links'),
      (snapshot) =>
        setPoints(
          snapshot.docs
            .map((d) => ({ id: d.id, ...(d.data() as { title?: string; url?: string; geoLat?: number; geoLng?: number; deletedAt?: number }) }))
            .filter((l) => l.geoLat != null && l.geoLng != null && !l.deletedAt)
            .map((l) => ({ id: l.id, title: l.title || 'Точка', lat: l.geoLat as number, lng: l.geoLng as number }))
        ),
      listenError('map block points')
    );
  }, [visible]);

  async function shoot() {
    if (busy) return;
    setBusy(true);
    const view = viewRef.current?.() ?? start;
    const uri = await snapshotRef.current?.();
    setBusy(false);
    if (uri && view) onShot({ uri, view });
  }

  const tool = (icon: string, label: string, onPress: () => void, active = false) => (
    <Pressable onPress={onPress} style={[styles.tool, active && { backgroundColor: S.accent }]} accessibilityLabel={label}>
      <Ionicons name={icon as never} size={21} color={active ? S.chrome : S.ink} />
      <Text style={[styles.toolLabel, { color: active ? S.chrome : S.ink2 }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.dim}>
        <View style={[styles.window, { marginTop: insets.top + 12, marginBottom: insets.bottom + 12, borderColor: S.line }]}>
          {visible && start && (
            <GeoMapView
              points={points}
              onPressPoint={() => {}}
              bare
              start={start}
              rulerOn={rulerOn}
              onRulerChange={setRulerOn}
              snapshotRef={snapshotRef}
              viewRef={viewRef}
              bottomInset={84}
            />
          )}
          <View style={styles.top} pointerEvents="box-none">
            <View style={[styles.pill, { backgroundColor: S.chrome }]}>
              <Ionicons name="map-outline" size={16} color={S.ink} />
              <Text style={[styles.pillLabel, { color: S.ink }]}>Мапа в нотатці</Text>
            </View>
            <Pressable onPress={onClose} style={[styles.pill, { backgroundColor: S.ink }]}>
              <Ionicons name="checkmark" size={17} color={S.chrome} />
              <Text style={[styles.pillLabel, { color: S.chrome }]}>Готово</Text>
            </Pressable>
          </View>
          <View style={[styles.tools, { backgroundColor: S.chrome }]}>
            {tool('lc:ruler', 'Рулетка', () => setRulerOn((on) => !on), rulerOn)}
            {tool('camera-outline', busy ? 'Знімаю…' : 'Новий знімок', shoot)}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  window: { flex: 1, marginHorizontal: 10, borderRadius: 26, overflow: 'hidden', borderWidth: 1 },
  top: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 19 },
  pillLabel: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  tools: { position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', gap: 4, padding: 6, borderRadius: 30 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 14, borderRadius: 22 },
  toolLabel: { fontSize: 14, fontFamily: SOFT_MEDIUM },
});
