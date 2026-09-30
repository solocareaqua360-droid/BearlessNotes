import { ReactNode, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { DESKTOP_TOOLBAR_HEIGHT } from '../DesktopToolbar';
import EdgeFade from './EdgeFade';
import { useStartFront } from '../../navigation/desktopTabs';

// THE MAIN PANE WITH NO TOOLBAR BAND (2026-10-01, "не під смугою а замість
// смуги"): the toolbar's buttons float over the content, and what scrolls up
// goes UNDER them and melts into the window there, instead of being cut by a
// band's lower edge.
//
// Every screen already lays itself out below the toolbar (this wrapper pads
// its top by the toolbar's height), so a screen that does not scroll - a
// board, the calendar - stands exactly where it did. What changes is the
// screen's own top-level scroller: it is found in the page (a block whose
// top is the content's top and that scrolls vertically), pulled up under
// the toolbar by the toolbar's height and padded back down by the same, so
// its content STARTS where it always did and scrolls on up under the buttons.
// Nothing in the screens has to know.
const PULLED = 'mindevaUnderToolbar';

export default function UnderToolbar({ children }: { children: ReactNode }) {
  const ref = useRef<View | null>(null);
  // The start page stands over the screen; its ground is glass now, so the
  // screen under it is put out of sight while it is in front.
  const startFront = useStartFront();
  useEffect(() => {
    const host = ref.current as unknown as HTMLElement | null;
    if (!host || typeof MutationObserver === 'undefined') return;
    let queued = 0;
    const pull = () => {
      queued = 0;
      const hostRect = host.getBoundingClientRect();
      const top = hostRect.top + DESKTOP_TOOLBAR_HEIGHT;
      host.querySelectorAll<HTMLElement>('div').forEach((el) => {
        if (el.dataset[PULLED]) return;
        const style = getComputedStyle(el);
        if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') return;
        const rect = el.getBoundingClientRect();
        // Only a screen's own scroller: it starts at (or a little below) where
        // the content starts, spans most of the pane, and is not a small list
        // inside a card.
        if (rect.top < top - 2 || rect.top > top + 32) return;
        if (rect.height < 200 || rect.width < hostRect.width * 0.5) return;
        // Up to the pane's very top, and its content back down by as much.
        // ADDED to what the scroller already has - a screen's own top padding
        // or margin stays its own (overwriting it pulled the note's title up
        // under the buttons).
        const lift = Math.round(rect.top - hostRect.top);
        const margin = parseFloat(style.marginTop) || 0;
        const padding = parseFloat(style.paddingTop) || 0;
        el.dataset[PULLED] = '1';
        el.style.marginTop = `${margin - lift}px`;
        el.style.paddingTop = `${padding + lift}px`;
        el.style.scrollPaddingTop = `${lift}px`;
      });
    };
    const schedule = () => {
      if (!queued) queued = requestAnimationFrame(pull);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(host, { childList: true, subtree: true });
    schedule();
    return () => {
      observer.disconnect();
      if (queued) cancelAnimationFrame(queued);
    };
  }, []);
  return (
    <View ref={ref} style={{ flex: 1, minWidth: 0, paddingTop: DESKTOP_TOOLBAR_HEIGHT }}>
      <View style={[{ flex: 1, minHeight: 0 }, startFront && ({ visibility: 'hidden' } as never)]}>{children}</View>
      {/* Where the band was: what scrolls up under the buttons blurs away. */}
      <EdgeFade edge="top" height={DESKTOP_TOOLBAR_HEIGHT + 20} />
      <EdgeFade />
    </View>
  );
}
