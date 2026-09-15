import React from 'react';
import { FlexWidget, ImageWidget, TextWidget, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import AsyncStorage from '@react-native-async-storage/async-storage';

// A sticker on the home screen.
//
// A widget lives in the LAUNCHER's process, drawn from RemoteViews - no
// React Native view, no Firestore, no local file paths (ImageWidget only
// takes http(s):/data: sources) - so what it shows has to be handed to
// it whole. The configuration screen (StickerWidgetConfigScreen, opened
// by Android when the widget is placed or reconfigured) is the one place
// with a real screen to pick a sticker on; it resolves the sticker to a
// plain object - text and a colour, or a small base64 PNG - and writes
// it here, under the widget's own id. This just reads it back when the
// launcher asks for a redraw.
//
// Everything in here is JS and ships over the air; the only native fact
// about the widget is its shape, declared in app.json.

export const STICKER_WIDGET_KEY = (widgetId: number) => `widget:sticker:${widgetId}`;

export type StoredSticker =
  | { kind: 'text'; text: string; color: `#${string}` }
  // `image` is a data: URI (see stickerFromItem) - the only local form
  // ImageWidget accepts. A sketch sticker is flattened to one of these
  // at configuration time, since there is nowhere later to draw an SVG.
  | { kind: 'image'; image: `data:image${string}`; color: `#${string}` };

// The one place the widget's shape is drawn - the task handler (a
// redraw the launcher asked for) and the configuration screen (the
// preview right after picking a sticker) both go through this, so the
// two can never drift apart.
export function stickerWidgetElement(sticker: StoredSticker | null, width: number, height: number) {
  if (sticker?.kind === 'image') {
    return (
      <FlexWidget
        style={{ width, height, backgroundColor: sticker.color, borderRadius: 18, overflow: 'hidden' }}
        clickAction="OPEN_APP"
      >
        <ImageWidget image={sticker.image} imageWidth={width} imageHeight={height} resizeMode="cover" />
      </FlexWidget>
    );
  }
  return (
    <FlexWidget
      style={{
        width,
        height,
        backgroundColor: sticker?.color ?? '#FBE97A',
        borderRadius: 18,
        padding: 14,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
      }}
      clickAction="OPEN_APP"
    >
      <TextWidget
        text={sticker?.kind === 'text' ? sticker.text : 'Стікер mindEva\n\nЗатисни й обери «Налаштувати», щоб вибрати стікер.'}
        style={{ fontSize: 15, color: '#1F2937' }}
        maxLines={12}
      />
    </FlexWidget>
  );
}

export async function stickerWidgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetInfo, renderWidget } = props;
  const raw = await AsyncStorage.getItem(STICKER_WIDGET_KEY(widgetInfo.widgetId)).catch(() => null);
  let sticker: StoredSticker | null = null;
  if (raw) {
    try {
      sticker = JSON.parse(raw) as StoredSticker;
    } catch {
      sticker = null;
    }
  }
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
    case 'WIDGET_CLICK':
      renderWidget(stickerWidgetElement(sticker, widgetInfo.width, widgetInfo.height));
      break;
    case 'WIDGET_DELETED':
      await AsyncStorage.removeItem(STICKER_WIDGET_KEY(widgetInfo.widgetId)).catch(() => undefined);
      break;
  }
}
