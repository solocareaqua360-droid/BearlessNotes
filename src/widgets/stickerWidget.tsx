import React from 'react';
import { FlexWidget, TextWidget, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import AsyncStorage from '@react-native-async-storage/async-storage';

// A sticker on the home screen.
//
// A widget lives in the LAUNCHER's process, drawn from RemoteViews - no
// React Native view, no Firestore - so what it shows has to be handed
// to it: the app writes each sticker it is asked to show into local
// storage under the widget's own id, and this reads it back when the
// launcher asks for a redraw. The first version shows a placeholder
// until the app has written something; choosing WHICH sticker a widget
// shows is the configuration screen, which is JS and comes over the air.
//
// Everything in here is JS and ships over the air; the only native fact
// about the widget is its shape, declared in app.json.

export const STICKER_WIDGET_KEY = (widgetId: number) => `widget:sticker:${widgetId}`;

// The colour is a hex string; the widget library types it as `#${string}`.
type StoredSticker = { text: string; color: `#${string}` };

function StickerView({ sticker, width, height }: { sticker: StoredSticker | null; width: number; height: number }) {
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
        text={sticker?.text ?? 'Стікер mindEva\n\nЗатисни й обери «Налаштувати», щоб вибрати стікер.'}
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
      renderWidget(<StickerView sticker={sticker} width={widgetInfo.width} height={widgetInfo.height} />);
      break;
    case 'WIDGET_DELETED':
      await AsyncStorage.removeItem(STICKER_WIDGET_KEY(widgetInfo.widgetId)).catch(() => undefined);
      break;
  }
}
