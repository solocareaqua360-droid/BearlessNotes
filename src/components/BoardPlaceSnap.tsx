import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import BoardMiniMap from './BoardMiniMap';
import { currentBoardView, requestBoardJump, useBoardLive, type BoardView } from '../utils/boardMap';
import { useTheme } from '../theme/ThemeProvider';

// A line of a board's map (utils/boardMap): the picture of the place (the board's own cards drawn small, cropped to what the screen showed
// then), «Перейти» (the board goes there) and «Оновити» (the place is taken again from what the board shows now). The picture needs the board
// open (it is drawn from its data); with the board closed the buttons remain and the picture waits.
const MAX_H = 260;

export default function BoardPlaceSnap({
  view,
  onRefresh,
  onMissing,
}: {
  view: BoardView;
  onRefresh: (next: BoardView) => void;
  onMissing: () => void;
}) {
  const theme = useTheme();
  const live = useBoardLive(view.boardId);
  const [width, setWidth] = useState(0);
  const hasRegion = !!view.w && !!view.h;
  const height = hasRegion && width ? Math.min(MAX_H, Math.round((width * view.h!) / view.w!)) : 0;
  const button = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 13,
    backgroundColor: theme.paper.inkMuted + '1F',
  };
  const text = { fontSize: 12.5, color: theme.paper.inkMuted, fontWeight: '600' as const };
  const noFocus = { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object;
  return (
    <View style={{ marginTop: 6, marginLeft: 4, gap: 6 }}>
      {hasRegion && !!live && (
        <View
          onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
          style={{ height: height || 1, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.paper.inkMuted + '14' }}
        >
          {height > 0 && (
            <BoardMiniMap
              cards={live.cards}
              columns={live.columns}
              connections={live.connections}
              shapes={live.shapes}
              containers={live.containers}
              width={width}
              height={height}
              showText
              detailed
              region={{ x: view.x - view.w! / 2, y: view.y - view.h! / 2, width: view.w!, height: view.h! }}
            />
          )}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={() => {
            if (!requestBoardJump(view)) onMissing();
          }}
          hitSlop={6}
          accessibilityLabel="Перейти до ділянки дошки"
          style={button}
          {...noFocus}
        >
          <Ionicons name="locate" size={14} color={theme.paper.inkMuted} />
          <Text style={text}>Перейти</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const next = currentBoardView(view.boardId);
            if (next) onRefresh(next);
            else onMissing();
          }}
          hitSlop={6}
          accessibilityLabel="Оновити ділянку з поточного вигляду дошки"
          style={button}
          {...noFocus}
        >
          <Ionicons name="refresh" size={14} color={theme.paper.inkMuted} />
          <Text style={text}>Оновити</Text>
        </Pressable>
      </View>
    </View>
  );
}
