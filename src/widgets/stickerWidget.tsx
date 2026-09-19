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
  | { kind: 'text'; id: string; text: string; color: `#${string}` }
  // `image` is a data: URI (see stickerFromItem) - the only local form
  // ImageWidget accepts. A sketch sticker is flattened to one of these
  // at configuration time, since there is nowhere later to draw an SVG.
  | { kind: 'image'; id: string; image: `data:image${string}`; color: `#${string}` };

// The one place the widget's shape is drawn - the task handler (a
// redraw the launcher asked for) and the configuration screen (the
// preview right after picking a sticker) both go through this, so the
// two can never drift apart.
// A tap goes straight to THIS sticker, not just the app in general - a
// deep link the app parses in App.tsx into `Stickers` with the id as a
// param. Without a sticker to open (the placeholder, before the widget
// has been configured) there is nowhere to send it, so it just opens
// the app.
function clickIntoSticker(sticker: StoredSticker | null) {
  return sticker ? { clickAction: 'OPEN_URI', clickActionData: { uri: `mindeva://sticker/${sticker.id}` } } : { clickAction: 'OPEN_APP' };
}

export function stickerWidgetElement(sticker: StoredSticker | null, width: number, height: number) {
  if (sticker?.kind === 'image') {
    return (
      <FlexWidget
        style={{ width, height, backgroundColor: sticker.color, borderRadius: 18, overflow: 'hidden' }}
        {...clickIntoSticker(sticker)}
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
      {...clickIntoSticker(sticker)}
    >
      <TextWidget
        text={sticker?.kind === 'text' ? sticker.text : 'Стікер mindEva\n\nЗатисни й обери «Налаштувати», щоб вибрати стікер.'}
        // A widget is glanced at from across a room, not read closely -
        // 15 was sized like a line of the app itself, which is too
        // small for that. Fewer lines fit at 20, which is the point:
        // a sticker on the home screen is a couple of words, not a
        // paragraph.
        style={{ fontSize: 20, fontWeight: '600', color: '#1F2937' }}
        maxLines={8}
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
