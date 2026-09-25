import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import GlassLayer from './GlassLayer';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { confirm, notify } from './surfaces/Ask';
import GeoAreaPicker from './GeoAreaPicker';
import {
  deleteRegion,
  downloadRegion,
  estimateRegionSize,
  formatBytes,
  listRegions,
  type OfflineDetail,
  type OfflineRegion,
} from '../utils/geoOfflinePacks';

// Named pieces of the map, kept on the device for viewing with no
// connection at all - the whole reason MapLibre was chosen over Google
// Maps in the first place (see the memory android_dex_density_trap's
// sibling discussion - Google's own terms forbid exactly this). A list,
// each region with its own name and weight, deletable one at a time -
// never a single "clear cache" the user has no say in.
export default function GeoOfflineRegionsSheet({
  visible,
  currentBounds,
  onClose,
}: {
  visible: boolean;
  // What "Завантажити цей вигляд" downloads - the map's own bounds at
  // the moment this sheet was opened. Null before the map has reported
  // any (the first frame or two after it mounts).
  currentBounds: [number, number, number, number] | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [regions, setRegions] = useState<OfflineRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [detail, setDetail] = useState<OfflineDetail>('standard');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [customBounds, setCustomBounds] = useState<[number, number, number, number] | null>(null);
  const [areaPickerVisible, setAreaPickerVisible] = useState(false);

  // A hand-drawn area (GeoAreaPicker) stands in for "what's on screen"
  // once the user picks one - everything downstream (the estimate, the
  // actual download) reads this instead of `currentBounds` directly.
  const effectiveBounds = customBounds ?? currentBounds;

  // Pure math, no network - recomputed the instant the user switches
  // detail level or the chosen area, so the number on screen is never
  // stale.
  const estimate = useMemo(
    () => (effectiveBounds ? estimateRegionSize(effectiveBounds, detail) : null),
    [effectiveBounds, detail]
  );

  useEffect(() => {
    if (!visible) return;
    setAdding(false);
    setName('');
    setDetail('standard');
    setCustomBounds(null);
    refreshRegions();
  }, [visible]);

  async function refreshRegions() {
    setLoading(true);
    try {
      setRegions(await listRegions());
    } catch {
      // A device with nothing downloaded yet, or the library's own
      // store not ready on the very first call - an empty list either
      // way, not an error worth a toast for.
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!effectiveBounds || !name.trim()) return;
    setDownloadProgress(0);
    try {
      await downloadRegion(name.trim(), effectiveBounds, detail, setDownloadProgress);
      setAdding(false);
      setName('');
      setCustomBounds(null);
      await refreshRegions();
    } catch (e) {
      notify('Не вдалося завантажити', e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadProgress(null);
    }
  }

  async function handleDelete(region: OfflineRegion) {
    const yes = await confirm({
      title: `Видалити «${region.name}»?`,
      message: 'Ці плитки мапи більше не будуть доступні офлайн.',
      confirmLabel: 'Видалити',
    });
    if (!yes) return;
    await deleteRegion(region.id);
    await refreshRegions();
  }

  return (
    <GlassLayer visible={visible} onClose={onClose} intensity={60}>
      <View style={styles.frame} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Офлайн-райони</Text>
            <Pressable hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={22} color={theme.ink.muted} />
            </Pressable>
          </View>

          {adding ? (
            downloadProgress !== null ? (
              <View style={styles.progressBlock}>
                <ActivityIndicator color={theme.accent} />
                <Text style={styles.progressText}>Завантаження… {Math.round(downloadProgress * 100)}%</Text>
              </View>
            ) : (
              <>
                <TextInput
                  autoFocus
                  value={name}
                  onChangeText={setName}
                  placeholder="Назва району"
                  placeholderTextColor={theme.ink.faint}
                  style={styles.input}
                />
                <View style={styles.detailRow}>
                  {(
                    [
                      ['standard', 'Звичайна деталізація'],
                      ['high', 'Висока'],
                    ] as [OfflineDetail, string][]
                  ).map(([d, label]) => (
                    <Pressable
                      key={d}
                      style={[styles.detailTab, detail === d && styles.detailTabActive]}
                      onPress={() => setDetail(d)}
                    >
                      <Text style={[styles.detailLabel, detail === d && styles.detailLabelActive]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.hint}>
                  {customBounds ? 'Завантажить вибрану ділянку' : 'Завантажить те, що зараз видно на мапі'}
                  {estimate ? ` — орієнтовно ${formatBytes(estimate.bytes)}` : ''}.
                </Text>
                <View style={styles.areaLinks}>
                  <Pressable hitSlop={6} onPress={() => setAreaPickerVisible(true)}>
                    <Text style={styles.areaLink}>Вибрати ділянку на мапі</Text>
                  </Pressable>
                  {customBounds && (
                    <Pressable hitSlop={6} onPress={() => setCustomBounds(null)}>
                      <Text style={styles.areaLink}>Скинути до поточного вигляду</Text>
                    </Pressable>
                  )}
                </View>
                <View style={styles.buttons}>
                  <Pressable style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} onPress={() => setAdding(false)}>
                    <Text style={styles.cancelLabel}>Скасувати</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.saveButton,
                      !name.trim() && styles.saveButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                    disabled={!name.trim()}
                    onPress={handleDownload}
                  >
                    <Text style={styles.saveLabel}>Завантажити</Text>
                  </Pressable>
                </View>
              </>
            )
          ) : (
            <>
              <Pressable
                style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
                onPress={() => setAdding(true)}
              >
                <Ionicons name="cloud-download-outline" size={17} color={theme.onAccent} />
                <Text style={styles.addButtonText}>Завантажити цей вигляд офлайн</Text>
              </Pressable>

              {loading ? (
                <ActivityIndicator color={theme.ink.muted} style={styles.loading} />
              ) : regions.length === 0 ? (
                <Text style={styles.emptyText}>Ще немає завантажених районів</Text>
              ) : (
                regions.map((region) => (
                  <View key={region.id} style={styles.regionRow}>
                    <View style={styles.regionInfo}>
                      <Text style={styles.regionName} numberOfLines={1}>
                        {region.name}
                      </Text>
                      <Text style={styles.regionSize}>{formatBytes(region.bytes)}</Text>
                    </View>
                    <Pressable hitSlop={8} onPress={() => handleDelete(region)}>
                      <Ionicons name="trash-outline" size={18} color={theme.ink.faint} />
                    </Pressable>
                  </View>
                ))
              )}
            </>
          )}
        </View>
      </View>
      <GeoAreaPicker
        visible={areaPickerVisible}
        initialBounds={currentBounds}
        onCancel={() => setAreaPickerVisible(false)}
        onConfirm={(bounds) => {
          setCustomBounds(bounds);
          setAreaPickerVisible(false);
        }}
      />
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: SHEET_FRAME,
  card: {
    ...SHEET_WINDOW,
    maxHeight: '80%',
    backgroundColor: t.raised,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    padding: 20,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.accent,
    borderRadius: 18,
    minHeight: 48,
  },
  addButtonText: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: t.onAccent,
  },
  loading: {
    marginTop: 8,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
    textAlign: 'center',
    paddingVertical: 8,
  },
  regionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: t.field.fill,
  },
  regionInfo: {
    flex: 1,
    gap: 2,
  },
  regionName: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  regionSize: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  input: {
    backgroundColor: t.field.fill,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  detailRow: {
    flexDirection: 'row',
    backgroundColor: t.field.fill,
    borderRadius: 14,
    padding: 3,
    gap: 3,
  },
  detailTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 11,
    alignItems: 'center',
  },
  detailTabActive: {
    backgroundColor: t.accent,
  },
  detailLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  detailLabelActive: {
    color: t.onAccent,
  },
  hint: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
    marginTop: -4,
  },
  areaLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  areaLink: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.accent,
  },
  progressBlock: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  progressText: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  pressed: {
    opacity: 0.7,
  },
  cancelButton: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  cancelLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  saveButton: {
    backgroundColor: t.accent,
    borderRadius: 18,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: t.onAccent,
  },
});
