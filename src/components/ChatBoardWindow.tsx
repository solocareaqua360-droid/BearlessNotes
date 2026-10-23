import { ReactNode, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import BoardScreen from '../screens/BoardScreen';
import EmbeddedScreenHost from './EmbeddedScreenHost';
import { BoardEmbedContext, type BoardEmbed } from './boardEmbedContext';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';

// THE AI CHAT'S BOARD, IN A WINDOW over the chat (sketches chatg/chatj/chatk of 2026-10-24): not a picture of the board but
// the real BoardScreen, shrunk, that pans, zooms and unfolds its cards. The chat's input stays visible below it
// (top/bottom say where the window lies). A plain absolute View, never a Modal - a Modal would take the chat's own
// touches and the ask() sheets would draw under it. BoardScreen is mounted only while this window is, so nothing of the
// board listens while it is closed.
//
// The board itself is told it is a window through BoardEmbedContext: no «recents», no preview upload, a document card
// unfolds in place, and the selected card ids come back here so the OWNER can draw its own bar for them
// (renderSelectionBar: «Поглибити | Розгалузити | ⋯»), laid over the bottom centre of the board.
export default function ChatBoardWindow({
  boardId,
  focusCardIds,
  top = 250,
  bottom = 90,
  title = 'Дошка',
  subtitle,
  subtitleAction,
  saveLabel = 'Зберегти як дошку',
  onSave,
  onClose,
  refreshTick,
  fitTick,
  renderSelectionBar,
}: {
  boardId: string;
  focusCardIds?: string[];
  top?: number;
  bottom?: number;
  title?: string;
  subtitle?: string;
  // A word after the subtitle that does something (the AI's last change: «Скасувати»).
  subtitleAction?: { label: string; onPress: () => void };
  saveLabel?: string;
  onSave?: () => void;
  onClose: () => void;
  refreshTick?: number;
  fitTick?: number;
  renderSelectionBar?: (selectedCardIds: string[], clear: () => void) => ReactNode;
}) {
  const S = useSoft();
  const styles = useMemo(() => makeStyles(S), [S]);
  const [selected, setSelected] = useState<{ ids: string[]; clear: () => void }>({ ids: [], clear: () => {} });

  // Registered in a LAYOUT effect: the board's own back handlers register later (a passive effect, after it mounts), and
  // the one registered last is asked first - so a sheet open on the board gets its back press before the window does.
  useLayoutEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const onSelection = useCallback((ids: string[], clear: () => void) => {
    setSelected((prev) => (prev.clear === clear && prev.ids.length === ids.length && prev.ids.every((id, i) => id === ids[i]) ? prev : { ids, clear }));
  }, []);
  const embed = useMemo<BoardEmbed>(
    () => ({ onSelection, previewsTick: refreshTick ?? 0, noRecents: true, noPreviewCapture: true, noCardWindow: true, fitAll: true, fitTick: fitTick ?? 0 }),
    [onSelection, refreshTick, fitTick]
  );
  const focusKey = focusCardIds?.join(',') ?? '';
  const params = useMemo(() => ({ boardId, focusCardIds: focusKey ? focusKey.split(',') : undefined }), [boardId, focusKey]);
  const bar = renderSelectionBar && selected.ids.length > 0 ? renderSelectionBar(selected.ids, selected.clear) : null;

  return (
    <View style={[styles.window, { top, bottom }]}>
      <View style={styles.head}>
        <Ionicons name="grid-outline" size={20} color={S.accent} />
        <View style={styles.titleBox}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle || subtitleAction ? (
            <Text style={styles.sub} numberOfLines={1}>
              {subtitle ? `${subtitle}${subtitleAction ? ' · ' : ''}` : ''}
              {subtitleAction ? (
                <Text onPress={subtitleAction.onPress} style={styles.subAction}>
                  {subtitleAction.label}
                </Text>
              ) : null}
            </Text>
          ) : null}
        </View>
        {onSave ? (
          <Pressable onPress={onSave} style={styles.save} accessibilityLabel={saveLabel}>
            <Text style={styles.saveText}>{saveLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Закрити вікно" hitSlop={6}>
          <Ionicons name="close" size={16} color={S.ink} />
        </Pressable>
      </View>
      <View style={styles.board}>
        <BoardEmbedContext.Provider value={embed}>
          {/* Re-mounted after each change the AI makes: the board does not take such a write in while it is open. */}
          <EmbeddedScreenHost key={refreshTick ?? 0} routeName="BoardCopy" params={params} onClose={onClose}>
            <BoardScreen />
          </EmbeddedScreenHost>
        </BoardEmbedContext.Provider>
        {bar ? (
          <View pointerEvents="box-none" style={styles.barBox}>
            {bar}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(S: ReturnType<typeof useSoft>) {
  return StyleSheet.create({
    window: {
      position: 'absolute',
      left: 8,
      right: 8,
      borderRadius: 28,
      backgroundColor: S.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: S.line,
      overflow: 'hidden',
      boxShadow: S.shadow,
    } as never,
    head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 8, paddingVertical: 8 },
    titleBox: { flex: 1, minWidth: 0 },
    title: { fontSize: 15, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    sub: { fontSize: 12, fontFamily: SOFT_REGULAR, color: S.ink2 },
    subAction: { fontFamily: SOFT_SEMIBOLD, color: S.accent },
    save: { height: 40, borderRadius: 20, paddingHorizontal: 16, backgroundColor: S.ink, alignItems: 'center', justifyContent: 'center' },
    saveText: { fontSize: 15, fontFamily: SOFT_MEDIUM, color: S.card },
    close: { width: 40, height: 40, borderRadius: 20, backgroundColor: S.card, alignItems: 'center', justifyContent: 'center', boxShadow: S.shadow } as never,
    board: { flex: 1, minHeight: 0, marginHorizontal: 6, marginBottom: 6, borderRadius: 22, overflow: 'hidden' },
    barBox: { position: 'absolute', left: 0, right: 0, bottom: 12, alignItems: 'center' },
  });
}
