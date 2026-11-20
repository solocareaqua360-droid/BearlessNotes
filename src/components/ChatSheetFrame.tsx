import { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSoft } from '../theme/soft';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

// THE FRAME OF THE AI CHAT'S SHEETS (sketches chatl, chatn, chatp of 2026-10-24): a dimmed screen and a sheet rising from the
// bottom, with a handle. A plain absolute View, never a Modal (an ask() sheet or the keyboard would draw under a Modal): the OWNER
// puts it last in the chat screen's root. `top` is how far below the screen's top the sheet starts; the keyboard lifts its bottom.
export default function ChatSheetFrame({
  visible,
  onClose,
  top = 84,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  top?: number;
  children: ReactNode;
}) {
  const S = useSoft();
  const keyboard = useKeyboardHeight();
  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: S.dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.22)' }]} onPress={onClose} accessibilityLabel="Закрити" />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top,
          bottom: keyboard,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          backgroundColor: S.bg,
          paddingTop: 10,
          paddingHorizontal: 14,
          paddingBottom: keyboard > 0 ? 10 : 16,
          gap: 10,
          overflow: 'hidden',
          boxShadow: S.shadow,
        } as never}
      >
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: S.line }} />
        </View>
        {children}
      </View>
    </View>
  );
}
