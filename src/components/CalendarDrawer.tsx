import { useMemo } from 'react';
import CalendarScreen from '../screens/CalendarScreen';
import DatabasesScreen from '../screens/DatabasesScreen';
import { useWindowDimensions } from 'react-native';
import { CalendarDrawerContext, DatabasesLayerContext, databasesDrawerWidth, useSideDrawers } from '../navigation/sideDrawers';
import SideLayer from './SideLayer';

// The whole window: the two screens beside the desks are screens, not
// drawers - iOS's widgets page and app library.
export const SIDE_DRAWER_FRACTION = 1;

// THE CALENDAR, left of the first desk - "календар повноцінний ... в
// крайньому лівому екрані і блюром поверх робочого столу". The same
// CalendarScreen, told it lives here (CalendarDrawerContext): it draws its
// own bar and dock inside the layer and publishes nothing for the
// window's, which fade out as it comes in.
export default function CalendarDrawer() {
  const { calendarOpen, closeCalendar, calendarProgress, calendarDragging, calendarJump } = useSideDrawers();
  const drawer = useMemo(
    () => ({ open: calendarOpen, close: closeCalendar, jump: calendarJump }),
    [calendarOpen, closeCalendar, calendarJump]
  );
  return (
    <SideLayer side="left" open={calendarOpen} close={closeCalendar} progress={calendarProgress} dragging={calendarDragging}>
      <CalendarDrawerContext.Provider value={drawer}>
        <CalendarScreen />
      </CalendarDrawerContext.Provider>
    </SideLayer>
  );
}

// THE DATABASES, right of the last desk - the app library. «Більше» as it
// is, over the blurred desk; a tap on a tile opens that database full
// screen, and the layer steps aside for it. On a wide screen it is a
// drawer instead (databasesDrawerWidth), and a database opens inside it.
export function DatabasesLayer() {
  const { databasesOpen, closeDatabases, databasesProgress, databasesDragging } = useSideDrawers();
  const { width } = useWindowDimensions();
  const panelWidth = databasesDrawerWidth(width);
  const narrow = panelWidth < width;
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
        <DatabasesScreen />
      </DatabasesLayerContext.Provider>
    </SideLayer>
  );
}
