import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { captureRef } from 'react-native-view-shot';
import type { WidgetConfigurationScreenProps } from 'react-native-android-widget';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { ensureLocalFile } from '../utils/googleDrive';
import { SketchElement } from '../types';
import { FONT_MEDIUM, FONT_REGULAR } from '../utils/fonts';
import { STICKER_WIDGET_KEY, stickerWidgetElement, type StoredSticker } from './stickerWidget';

const STICKER_YELLOW = '#FBE97A';
const STICKER_DARK = '#4a3f05';

// The screen Android opens when the widget is placed, and again whenever
// the user holds it and picks "Налаштувати" - see widgetFeatures in
// app.json. It is the one moment the widget has a real screen to pick a
// sticker on, so everything that cannot be done later (reading Firestore,
// pulling a Drive backup, flattening a sketch to a bitmap) happens here.
//
// Not the app's own StickersScreen chrome - this runs as its own
// Activity, outside the navigator, and needs none of it: a plain grid,
// tap to choose, done.

type StickerItem = {
  id: string;
  type: 'paragraph' | 'image' | 'sketch';
  text?: string;
  imageUri?: string;
  driveFileId?: string;
  sketchElements?: SketchElement[];
  sketchWidth?: number;
  sketchHeight?: number;
  trashed?: boolean;
  updatedAt: number;
};

export default function StickerWidgetConfigScreen({ widgetInfo, renderWidget, setResult }: WidgetConfigurationScreenProps) {
  const [stickers, setStickers] = useState<StickerItem[] | null>(null);
  // The one sticker being turned into a widget right now - shown behind
  // a spinner while its picture is prepared, since a sketch or an
  // undownloaded photo takes a moment.
  const [preparingId, setPreparingId] = useState<string | null>(null);
  // A sketch sticker being captured is mounted here, off in the corner,
  // just long enough for captureRef to see it - see chooseSketch.
  const [sketchToCapture, setSketchToCapture] = useState<StickerItem | null>(null);
  const captureRefObj = useRef<View>(null);

  useEffect(() => {
    return onSnapshot(
      ownedQuery('stickers'),
      (snapshot) => {
        setStickers(
          snapshot.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<StickerItem, 'id'>) }))
            .filter((s) => !s.trashed)
            .sort((a, b) => b.updatedAt - a.updatedAt)
        );
      },
      () => setStickers([])
    );
  }, []);

  async function saveAndClose(sticker: StoredSticker) {
    await AsyncStorage.setItem(STICKER_WIDGET_KEY(widgetInfo.widgetId), JSON.stringify(sticker));
    // The task handler draws the exact same shape from the same data,
    // through the same function - so the preview here and every later
    // redraw can never drift apart.
    renderWidget(stickerWidgetElement(sticker, widgetInfo.width, widgetInfo.height));
    setResult('ok');
  }

  async function chooseText(item: StickerItem) {
    setPreparingId(item.id);
    await saveAndClose({ kind: 'text', id: item.id, text: item.text || 'Порожній стікер', color: STICKER_YELLOW });
    setPreparingId(null);
  }

  async function chooseImage(item: StickerItem) {
    if (!item.imageUri) return;
    setPreparingId(item.id);
    try {
      const here = await ensureLocalFile(item.imageUri, item.driveFileId);
      if (!here) throw new Error('missing');
      // Small on purpose: this is going into AsyncStorage as a plain
      // string, read back on every redraw - the widget is a few
      // centimetres across, so it never needed the original resolution.
      const context = ImageManipulator.manipulate(item.imageUri).resize({ width: 480 });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
      if (!saved.base64) throw new Error('no base64');
      await saveAndClose({ kind: 'image', id: item.id, image: `data:image/jpeg;base64,${saved.base64}`, color: '#000' });
    } catch {
      await chooseText({ ...item, text: 'Зображення недоступне' });
    } finally {
      setPreparingId(null);
    }
  }

  function chooseSketch(item: StickerItem) {
    // Mounted off-screen; the effect below waits for it to lay out, then
    // captures it and cleans up - there is no later moment to draw an
    // SVG, so this is done once, now, and kept as a bitmap from here on.
    setPreparingId(item.id);
    setSketchToCapture(item);
  }

  useEffect(() => {
    if (!sketchToCapture) return;
    const timer = setTimeout(async () => {
      try {
        const uri = await captureRef(captureRefObj, { format: 'png', result: 'data-uri' });
        if (!uri.startsWith('data:image')) throw new Error('bad capture');
        await saveAndClose({ kind: 'image', id: sketchToCapture.id, image: uri as `data:image${string}`, color: STICKER_YELLOW });
      } catch {
        await chooseText({ ...sketchToCapture, text: 'Малюнок недоступний' });
      } finally {
        setSketchToCapture(null);
        setPreparingId(null);
      }
      // A tick for the SVG to actually paint before the shot is taken.
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketchToCapture]);

  function choose(item: StickerItem) {
    if (preparingId) return;
    if (item.type === 'image') chooseImage(item);
    else if (item.type === 'sketch') chooseSketch(item);
    else chooseText(item);
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Обери стікер</Text>
        <Pressable hitSlop={10} onPress={() => setResult('cancel')}>
          <Ionicons name="close" size={24} color="#111827" />
        </Pressable>
      </View>
      {stickers === null ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : stickers.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyLabel}>Ще немає стікерів - створи один у застосунку</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {stickers.map((item) => (
            <Pressable key={item.id} style={styles.card} onPress={() => choose(item)} disabled={!!preparingId}>
              {item.type === 'image' && item.imageUri ? (
                <Image source={{ uri: item.imageUri }} style={styles.cardImage} resizeMode="cover" />
              ) : item.type === 'sketch' && (item.sketchElements?.length ?? 0) > 0 ? (
                <Svg width="100%" height="100%" viewBox={`0 0 ${item.sketchWidth || 1} ${item.sketchHeight || 1}`}>
                  {(item.sketchElements ?? []).map((el, i) =>
                    el.kind === 'text' ? (
                      <SvgText key={i} x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize}>
                        {el.text}
                      </SvgText>
                    ) : (
                      <Path key={i} d={el.d} stroke={el.color} strokeWidth={el.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    )
                  )}
                </Svg>
              ) : (
                <Text style={styles.cardText} numberOfLines={5}>
                  {item.text || 'Порожній стікер'}
                </Text>
              )}
              {preparingId === item.id && (
                <View style={styles.cardOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Off-screen: exists only long enough to be photographed. */}
      {sketchToCapture && (
        <View style={styles.offscreen} pointerEvents="none">
          <View
            ref={captureRefObj}
            collapsable={false}
            style={{
              width: sketchToCapture.sketchWidth || 200,
              height: sketchToCapture.sketchHeight || 200,
              backgroundColor: STICKER_YELLOW,
            }}
          >
            <Svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${sketchToCapture.sketchWidth || 1} ${sketchToCapture.sketchHeight || 1}`}
            >
              {(sketchToCapture.sketchElements ?? []).map((el, i) =>
                el.kind === 'text' ? (
                  <SvgText key={i} x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize}>
                    {el.text}
                  </SvgText>
                ) : (
                  <Path key={i} d={el.d} stroke={el.color} strokeWidth={el.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                )
              )}
            </Svg>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: { fontSize: 18, fontFamily: FONT_MEDIUM, color: '#111827' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyLabel: { fontSize: 14, fontFamily: FONT_REGULAR, color: '#9CA3AF', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16 },
  card: {
    width: '47%',
    aspectRatio: 1.3,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: STICKER_YELLOW,
    padding: 10,
  },
  cardImage: { width: '100%', height: '100%' },
  cardText: { fontSize: 13, fontFamily: FONT_REGULAR, color: STICKER_DARK },
  cardOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offscreen: { position: 'absolute', top: -2000, left: -2000 },
});
