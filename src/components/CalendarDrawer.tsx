import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Freeze from './Freeze';
import { DeskVisibilityContext, makeVisibilityBox, setBoxVisible, type VisibilityBox } from '../navigation/deskVisibility';
import CalendarScreen from '../screens/CalendarScreen';
import DatabasesScreen from '../screens/DatabasesScreen';
import { useWindowDimensions } from 'react-native';
import ChatScreen from '../screens/ChatScreen';
import { FEATURES } from '../features';
import { CalendarDrawerContext, ChatLayerContext, DatabasesLayerContext, databasesDrawerWidth, useSideDrawers } from '../navigation/sideDrawers';
import SideLayer from './SideLayer';
import { useRenderTimer } from '../utils/perfWatch';

// The whole window: the two screens beside the desks are screens, not
// drawers - iOS's widgets page and app library.
export const SIDE_DRAWER_FRACTION = 1;

// A shut drawer is kept but not rendered (the preview plan, stage 1): the
// whole calendar and the whole databases board used to re-render with the
// rest of the app while out of sight. Thawed the moment it is opened or
// dragged; frozen again only after it has finished sliding away.
const FREEZE_AFTER_MS = 450;
// The drawer's own visibility box (navigation/deskVisibility): shut, its
// screen's data waits instead of re-rendering a frozen calendar.
function useVisibilityBox(visible: boolean): VisibilityBox {
  const box = useRef<VisibilityBox | null>(null);
  if (!box.current) box.current = makeVisibilityBox(visible);
  setBoxVisible(box.current, visible);
  return box.current;
}

function useShutFreeze(visible: boolean): boolean {
  const [frozen, setFrozen] = useState(!visible);
  useEffect(() => {
    if (visible) {
      setFrozen(false);
      return;
    }
    const timer = setTimeout(() => setFrozen(true), FREEZE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [visible]);
  return frozen && !visible;
}

// THE CALENDAR, left of the first desk - "календар повноцінний ... в
// крайньому лівому екрані і блюром поверх робочого столу". The same
// CalendarScreen, told it lives here (CalendarDrawerContext): it draws its
// own bar and dock inside the layer and publishes nothing for the
// window's, which fade out as it comes in.
//
// With features.chatInLeftLayer the layer holds TWO pages, the calendar and
// the chat (ChatLayerContext), switched from the words in the layer's own
// bar. Both stay mounted once seen - the calendar keeps its day, the chat
// its place - and the one not in front is frozen and told the layer is not
// open for it, so it says nothing to the bar or the dock.
export default function CalendarDrawer() {
  useRenderTimer('Шторка календаря');
  const { calendarOpen, closeCalendar, calendarProgress, calendarDragging, calendarJump, leftPage, setLeftPage } = useSideDrawers();
  const chatOn = FEATURES.chatInLeftLayer;
  const calendarFront = !chatOn || leftPage === 'calendar';
  const pages = useMemo(
    () => ({
      calendar: () => setLeftPage('calendar'),
      chat: () => setLeftPage('chat'),
      board: () => setLeftPage('board'),
    }),
    [setLeftPage]
  );
  const drawer = useMemo(
    () => ({ open: calendarOpen && calendarFront, close: closeCalendar, jump: calendarJump, pages: chatOn ? pages : undefined }),
    [calendarOpen, calendarFront, closeCalendar, calendarJump, chatOn, pages]
  );
  const chatView: 'tape' | 'board' = leftPage === 'board' ? 'board' : 'tape';
  const chatLayer = useMemo(
    () => ({ open: calendarOpen && !calendarFront, close: closeCalendar, view: chatView, pages }),
    [calendarOpen, calendarFront, closeCalendar, chatView, pages]
  );
  const wanted = calendarOpen || calendarDragging;
  const frozen = useShutFreeze(wanted);
  const box = useVisibilityBox(!frozen);
  // The chat is built the first time the layer is pulled out on it, not at
  // the app's start.
  const [chatBuilt, setChatBuilt] = useState(false);
  useEffect(() => {
    if (chatOn && !calendarFront && wanted) setChatBuilt(true);
  }, [chatOn, calendarFront, wanted]);
  return (
    <SideLayer side="left" open={calendarOpen} close={closeCalendar} progress={calendarProgress} dragging={calendarDragging}>
      <View style={[StyleSheet.absoluteFill, !calendarFront && styles.away]}>
        <CalendarDrawerContext.Provider value={drawer}>
          <DeskVisibilityContext.Provider value={box}>
            <Freeze freeze={frozen || !calendarFront}>
              <CalendarScreen />
            </Freeze>
          </DeskVisibilityContext.Provider>
        </CalendarDrawerContext.Provider>
      </View>
      {chatOn && chatBuilt && (
        <View style={[StyleSheet.absoluteFill, calendarFront && styles.away]}>
          <ChatLayerContext.Provider value={chatLayer}>
            <DeskVisibilityContext.Provider value={box}>
              <Freeze freeze={frozen || calendarFront}>
                <ChatScreen />
              </Freeze>
            </DeskVisibilityContext.Provider>
          </ChatLayerContext.Provider>
        </View>
      )}
    </SideLayer>
  );
}

const styles = StyleSheet.create({
  // The page not in front: laid out nowhere, drawn nowhere.
  away: { display: 'none' },
});

// THE DATABASES, right of the last desk - the app library. «Більше» as it
// is, over the blurred desk; a tap on a tile opens that database full
// screen, and the layer steps aside for it. On a wide screen it is a
// drawer instead (databasesDrawerWidth), and a database opens inside it.
export function DatabasesLayer() {
  useRenderTimer('Шторка баз');
  const { databasesOpen, closeDatabases, databasesProgress, databasesDragging } = useSideDrawers();
  const { width } = useWindowDimensions();
  const panelWidth = databasesDrawerWidth(width);
  const narrow = panelWidth < width;
  const frozen = useShutFreeze(databasesOpen || databasesDragging);
  const box = useVisibilityBox(!frozen);
  const layer = useMemo(
    () => ({ open: databasesOpen, close: closeDatabases, narrow }),
    [databasesOpen, closeDatabases, narrow]
  );
  return (
    <SideLayer
      side="right"
      open={databasesOpen}
      close={closeDatabases}
      progress={databasesProgress}
      dragging={databasesDragging}
      panelWidth={panelWidth}
    >
      <DatabasesLayerContext.Provider value={layer}>
        {/* NOT frozen (2026-10-06): a tile dragged out of this drawer onto
            the desks is still this screen's - its ghost, its drop - after
            the drawer has shut, and freezing it there left the ghost
            hanging in the middle and the drop undone. Its data is quiet
            while shut anyway (the box, and useDatabaseContents). */}
        <DeskVisibilityContext.Provider value={box}>
          <DatabasesScreen />
        </DeskVisibilityContext.Provider>
      </DatabasesLayerContext.Provider>
    </SideLayer>
  );
}
