import { useEffect, useMemo, useRef, useState } from 'react';
import Freeze from './Freeze';
import { DeskVisibilityContext, makeVisibilityBox, setBoxVisible, type VisibilityBox } from '../navigation/deskVisibility';
import CalendarScreen from '../screens/CalendarScreen';
import DatabasesScreen from '../screens/DatabasesScreen';
import { useWindowDimensions } from 'react-native';
import { CalendarDrawerContext, DatabasesLayerContext, databasesDrawerWidth, useSideDrawers } from '../navigation/sideDrawers';
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
export default function CalendarDrawer() {
  useRenderTimer('Шторка календаря');
  const { calendarOpen, closeCalendar, calendarProgress, calendarDragging, calendarJump } = useSideDrawers();
  const drawer = useMemo(
    () => ({ open: calendarOpen, close: closeCalendar, jump: calendarJump }),
    [calendarOpen, closeCalendar, calendarJump]
  );
  const frozen = useShutFreeze(calendarOpen || calendarDragging);
  const box = useVisibilityBox(!frozen);
  return (
    <SideLayer side="left" open={calendarOpen} close={closeCalendar} progress={calendarProgress} dragging={calendarDragging}>
      <CalendarDrawerContext.Provider value={drawer}>
        <DeskVisibilityContext.Provider value={box}>
          <Freeze freeze={frozen}>
            <CalendarScreen />
          </Freeze>
        </DeskVisibilityContext.Provider>
      </CalendarDrawerContext.Provider>
    </SideLayer>
  );
}

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
        <DeskVisibilityContext.Provider value={box}>
          <Freeze freeze={frozen}>
            <DatabasesScreen />
          </Freeze>
        </DeskVisibilityContext.Provider>
      </DatabasesLayerContext.Provider>
    </SideLayer>
  );
}
