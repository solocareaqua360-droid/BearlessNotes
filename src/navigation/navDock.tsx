import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

// What the dock is showing instead of the desks.
//
// The dock (FloatingIslandTabBar) is the switch between the four desks.
// The user's own idea - «план навігації» in the project memory - is that
// it should change SHAPE with the context instead of the app growing a
// new control for every context: inside folders it becomes the path, in
// the calendar a date scrubber, and held down it always goes back to the
// dots that say which desk you are on, so context can never steal
// navigation.
//
// This is how a screen tells it. One publisher at a time - whichever
// screen is focused - and `null` means "nothing to say", which is when
// the dock is simply the dock.
// A small mark under a day - what it means is the screen's business, not
// the dock's. 'ink' takes the dock's own ink, 'accent' its accent.
export type DockMark = 'ink' | 'accent';

export type DockStripItem = {
  key: string;
  label: string;
  // A second, smaller line under the label - the weekday, in the
  // calendar. It is not a footnote: the user navigates by it.
  sub?: string;
  // The one item the strip is ORIENTED by, which is NOT the selected one.
  // The selected item is already in the middle, so its position says so;
  // what the middle cannot say is where you were before you scrolled
  // away. In the calendar this is today - the user's own reasoning: "я
  // хочу знати, який справді день, а не до якого я домотав".
  anchor?: boolean;
  marks?: DockMark[];
};

// The desks themselves, as a shape of the dock rather than a separate
// bar. They used to be drawn by the tab bar, which meant that at a
// database's ROOT - where there is no path - the dock was two different
// components stacked on one another: the tab bar's desks and this one's
// actions, neither aware of the other, and nothing to swipe between.
// The desks are a card like any other now.
// Which card of the stack is in front. Three, in the order they are
// wanted: what you are in, what you can do in it, and where else you
// could be.
export type DockFace = 'context' | 'actions' | 'desks';

export type DockDesk = { key: string; icon: string; active: boolean; onPress: () => void };

// The shapes the dock can take. A new context adds a case here and a
// publisher on its own screen; nothing else in the app has to know.
export type DockContext =
  | {
      kind: 'desks';
      icon: string;
      desks: DockDesk[];
      collapsed: boolean;
      onToggleCollapsed: () => void;
    }
  | {
      kind: 'path';
      // What this database IS - drawn in the bead that leads out of the
      // context, so the way out says where it goes.
      icon: string;
      // Folder names from the root down, the deepest last.
      crumbs: string[];
      // Where a crumb leads: '' is the root, which is also what puts the
      // desks back.
      onGo: (path: string) => void;
    }
  | {
      icon: string;
      // A run of things you scrub through with your thumb - days, for
      // now. The SCREEN builds the labels, because it is the one that
      // knows what they mean; the dock only draws them and reports a tap.
      kind: 'strip';
      items: DockStripItem[];
      selected: string;
      onPick: (key: string) => void;
    };

// How the dock's own crumbs become DROP TARGETS for a card being
// carried. It is a second, independent slot rather than part of the
// context: the screen publishes where it is (useExplorer) and the carry
// publishes how to register a target (useExplorerCarry), and those are
// two different hooks that learn their answers at different moments.
export type DockTargets = (path: string) => (node: View | null) => void;

// The way OUT of a whole screen, for the screens that are pushed over
// the tabs - a database opened from «Більше», a board, a note. Separate
// from the context because it is true whether or not there is a path:
// standing in a database's root there is nothing to show, and leaving
// the database is exactly the thing you want under your thumb.
export type DockLeave = { icon: string; onLeave: () => void };
// The way back on the four desks' own screens, drawn at the TOP-LEFT of
// the navigation bar (TopNavBar) rather than in the dock - the user's
// Notion-style plan. `dimmed`: in its place, nowhere to go.
export type TopBack = { onPress: () => void; dimmed: boolean };

// What this screen can DO - the other half of the dock's stack.
//
// Deliberately NOT part of the context. The user's own objection, and it
// settled the design: the dock answers "where am I", the rail answers
// "what can I do", and the two being both made of buttons does not make
// them one thing. They live in one place now but stay two objects - two
// capsules, one behind the other, the way a Samsung lock screen stacks
// its cards.
export type DockAction = {
  key: string;
  // An Ionicons name, or "mc:<name>" for a MaterialCommunityIcons one.
  icon: string;
  // One word under the icon, and it is not optional in spirit: the user
  // asked for words because a card of bare glyphs stops being readable
  // the moment the set of them changes from screen to screen - "іконки
  // починають мене плутати... ти вже не розумієш, яка із них що
  // значить". Keep it SHORT - the card is only a quarter of the screen
  // wide and each button gets a quarter of that.
  label?: string;
  onPress: () => void;
  // Done in one press, so the stack goes back to where-you-are by
  // itself: the card of actions is a drawer you opened for one thing,
  // not a place to stand.
  closesStack?: boolean;
  onLongPress?: () => void;
  active?: boolean;
  // A small glyph over the icon's corner - "the plus ON the thing it
  // adds", which is how this app has drawn creation since the user asked
  // for it.
  badge?: string;
  // A NUMBER over the icon's corner instead of a glyph - how many things
  // the action is about to act on. The note's select mode needs it: the
  // ticks on the blocks say which ones are chosen, but not once they
  // have been scrolled past, and "delete" is not a button to press
  // without knowing how many.
  count?: number;
};

// The two things that stay OUT of the stack, as beads either side of it.
// Samsung's lock screen keeps its torch and its camera exactly so: what
// never changes does not belong in a pile of cards that does.
export type DockBead = {
  icon: string;
  onPress: () => void;
  onLongPress?: () => void;
  active?: boolean;
  badge?: string;
  // Standing in its place but with nowhere to go - the way back on the
  // first desk's own root. The anchor stays put; it only goes quiet.
  dimmed?: boolean;
};

type Value = {
  face: DockFace;
  setFace: (face: DockFace) => void;
  // A face change that should be SEEN happening - see ContextDock's own
  // `flip`. `at` is what makes each request its own: asking for the same
  // card twice in a row is two flips, not one.
  flip: { face: DockFace; at: number } | null;
  requestFlip: (face: DockFace) => void;
  // What the dock falls back to when no screen has anything more
  // specific to say: the desks. A path or a calendar takes the front
  // while it exists; putting one away lands here rather than nowhere.
  base: DockContext | null;
  publishBase: (base: DockContext | null) => void;
  context: DockContext | null;
  actions: DockAction[] | null;
  // One claim per publisher, under its own id - see the Claim comment
  // below. Passing null withdraws that publisher's claim and nobody
  // else's.
  publishActions: (id: string, actions: DockAction[] | null) => void;
  beads: { left: DockBead | null; right: DockBead | null };
  publishBeads: (id: string, beads: { left: DockBead | null; right: DockBead | null } | null) => void;
  leave: DockLeave | null;
  publishLeave: (leave: DockLeave | null) => void;
  topBack: TopBack | null;
  publishTopBack: (back: TopBack | null) => void;
  // Whether the desks bar is drawn at the top (TopNavBar). While it is,
  // the path and the days rise under IT rather than above the dock.
  topNavUp: boolean;
  // A claim, not a flag: two bars can overlap for a beat while one screen
  // is pushed over another, and the last to let go of a flag would win.
  claimTopNav: () => () => void;
  publish: (context: DockContext | null) => void;
  // Stepped out of, without being given up: the context is still there,
  // one press brings it back. Lives here rather than in the dock because
  // the dock is drawn in more than one place now.
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  targets: DockTargets | null;
  publishTargets: (targets: DockTargets | null) => void;
  // True for the one beat, on a SWIPED desk change, between the native
  // pager visually settling on the new page and react-navigation's own
  // state catching up to it. A tap sets its target synchronously - the
  // same call that moves the page also moves this - but a swipe's
  // commit is a native event crossing back to JS, and everything a
  // screen publishes (its own context, its actions) is gated on
  // react-navigation's focus, which only flips once that event lands.
  // For that one beat the OLD screen's context is still the published
  // one, while the eye is already on the new screen - "док... опущений
  // трохи нижче... і тому... сіпається вниз", and only after a swipe,
  // never landing on a desk directly (confirmed on-device): a stale
  // card is what was sitting behind the desks card, peeking out under
  // it exactly where a real second card does. See FloatingIslandTabBar,
  // the one place that can see both the live page and the settled one.
  tabsInFlux: boolean;
  tabsDrifting: boolean;
  publishTabsDrifting: (drifting: boolean) => void;
  publishTabsInFlux: (inFlux: boolean) => void;
  // Whether the screen showing wants the stack to OPEN on its actions.
  //
  // The default is deliberate and stays: a screen with no context of its
  // own opens on the desks, because landing someone on the options by
  // accident is a bug this project already had and fixed. A note is the
  // one place where that default is wrong - its actions ARE its dock
  // («Полотно»/«Сторінка», the selection's own four), the desks mean
  // nothing while you are inside a document, and a note that opened on
  // the desks would have hidden the very buttons this merge was for.
  // So it is DECLARED by the screen, not inferred.
  prefersActions: boolean;
  publishPrefersActions: (prefers: boolean) => void;
  // Whether the screen showing wants the stack WIDER than usual.
  //
  // The user's own idea, for the note's select mode: nine actions in a
  // row that holds four is a lot of scrolling, and the room is right
  // there - a note publishes no beads, so the two slots either side of
  // the stack stand empty the whole time. Declared while the selection
  // lasts, the card grows into them and shrinks back after.
  //
  // It is a MORPH in the sense this project means it (see the card-to-
  // page note in the navigation plan): the shape changes, the object
  // does not. Nothing fades into anything.
  wide: boolean;
  publishWide: (wide: boolean) => void;

};

const NavDockContext = createContext<Value | null>(null);

function actionSignature(list: DockAction[] | null): string {
  return list
    ? list
        .map((a) => `${a.key}:${a.icon}:${a.label ?? ''}:${a.badge ?? ''}:${a.count ?? ''}:${a.active ? 1 : 0}`)
        .join('|')
    : '';
}

function beadSignature(beads: { left: DockBead | null; right: DockBead | null }): string {
  const one = (b: DockBead | null) => (b ? `${b.icon}:${b.badge ?? ''}:${b.active ? 1 : 0}:${b.dimmed ? 1 : 0}` : '-');
  return `${one(beads.left)}/${one(beads.right)}`;
}

// THE DOCK HAS ONE OF EACH AND CAN HAVE TWO SCREENS PUBLISHING AT ONCE.
// A note opened in another screen's pane is a second publisher, not a
// replacement for the first: both are mounted, both are "focused", and
// both write every time their own contents change.
//
// Last-writer-wins settled that by accident of effect order - React runs
// a child's effects before its parent's, so whoever re-rendered last
// owned the dock. That is why its contents changed three times over
// opening a note in a pane, growing it to full screen and shrinking it
// back: three different screens winning three different races, with the
// buttons changing identity under the finger ("людина буде нажахана").
//
// So every publisher keeps its own CLAIM instead, under its own id, and
// two rules follow from that:
//   - a publisher with nothing to say makes NO claim, rather than
//     clobbering everyone else with emptiness;
//   - withdrawing takes away only that publisher's OWN claim, so the one
//     underneath simply shows again - nobody has to re-publish to get
//     their buttons back.
// That second rule is the one that was costing whole controls: closing a
// note in a pane wiped the single slot, and the list behind it had no
// reason to write again, so the documents screen was left with neither
// search nor "new document" - "невже у мене немає можливості тепер
// створити документ?".
//
// WHICH claim is drawn while two of them stand is deliberately still
// what it was - the one written most recently - so this change fixes the
// disappearing without quietly deciding the other half of the question
// (who owns the dock while a note is open in a pane). That is a design
// decision, not a mechanism one, and it is taken separately.
type Claim<T> = { id: string; value: T };

function topClaim<T>(claims: Claim<T>[]): T | null {
  return claims.length > 0 ? claims[claims.length - 1].value : null;
}

function withClaim<T>(
  claims: Claim<T>[],
  id: string,
  value: T | null,
  same: (a: T, b: T) => boolean
): Claim<T>[] {
  const at = claims.findIndex((claim) => claim.id === id);
  if (value === null) return at === -1 ? claims : claims.filter((claim) => claim.id !== id);
  if (at !== -1 && same(claims[at].value, value)) return claims;
  // Written last, so drawn: a claim that changes goes to the end of the
  // queue, which is the same "most recent wins" the dock has always had
  // between two screens that both have something to say.
  return [...claims.filter((claim) => claim.id !== id), { id, value }];
}

export function NavDockProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<DockContext | null>(null);
  const publish = useCallback((next: DockContext | null) => {
    // Same context, same dock. A screen publishes from an effect that
    // runs on every render, and a fresh object each time would redraw the
    // dock with it.
    setContext((prev) => {
      if (prev === next) return prev;
      if (!prev || !next || prev.kind !== next.kind) return next;
      if (prev.kind === 'path' && next.kind === 'path') {
        const same =
          prev.crumbs.length === next.crumbs.length && prev.crumbs.every((c, i) => c === next.crumbs[i]);
        return same && prev.onGo === next.onGo ? prev : next;
      }
      if (prev.kind === 'strip' && next.kind === 'strip') {
        // By IDENTITY, not by comparing keys: the items carry marks that
        // arrive later than the days do (a dot query answering), and a
        // comparison that only looked at the first and last key would
        // call the strip unchanged and quietly keep the dotless version.
        // The publisher memoises, so identity is the honest test.
        const same =
          prev.items === next.items && prev.selected === next.selected && prev.onPick === next.onPick;
        return same ? prev : next;
      }
      return next;
    });
  }, []);
  // Held inside a box, not as the state itself: DockTargets IS a
  // function, and useState cannot tell a function it is meant to STORE
  // from a function it is meant to CALL as an updater.
  const [targetBox, setTargetBox] = useState<{ fn: DockTargets | null }>({ fn: null });
  const targets = targetBox.fn;
  // The same value never becomes a new render: this provider sits above
  // the entire app, so a needless setState here costs a pass over
  // everything - and a publisher handing over a fresh function each time
  // would loop, which is exactly what happened.
  const publishTargets = useCallback(
    (next: DockTargets | null) => setTargetBox((prev) => (prev.fn === next ? prev : { fn: next })),
    []
  );
  const [topNavClaims, setTopNavClaims] = useState(0);
  const topNavUp = topNavClaims > 0;
  const claimTopNav = useCallback(() => {
    setTopNavClaims((n) => n + 1);
    return () => setTopNavClaims((n) => n - 1);
  }, []);
  const [topBack, setTopBack] = useState<TopBack | null>(null);
  const publishTopBack = useCallback((next: TopBack | null) => {
    setTopBack((prev) => (prev === next || (prev && next && prev.onPress === next.onPress && prev.dimmed === next.dimmed) ? prev : next));
  }, []);
  const [leaveBox, setLeaveBox] = useState<{ value: DockLeave | null }>({ value: null });
  const leave = leaveBox.value;
  const publishLeave = useCallback((next: DockLeave | null) => {
    setLeaveBox((prev) => {
      const a = prev.value;
      if (a === next) return prev;
      if (a && next && a.icon === next.icon && a.onLeave === next.onLeave) return prev;
      return { value: next };
    });
  }, []);
  // Compared by SIGNATURE, not by identity: a screen builds this array
  // fresh on every render, and the handlers inside it close over state
  // that the signature already accounts for (an icon that changes with
  // the view mode, an `active` that changes with select mode).
  const [actionClaims, setActionClaims] = useState<Claim<DockAction[]>[]>([]);
  const publishActions = useCallback((id: string, next: DockAction[] | null) => {
    setActionClaims((prev) =>
      withClaim(
        prev,
        id,
        next && next.length > 0 ? next : null,
        (a, b) => actionSignature(a) === actionSignature(b)
      )
    );
  }, []);
  const actions = useMemo(() => topClaim(actionClaims), [actionClaims]);
  const [beadClaims, setBeadClaims] = useState<Claim<{ left: DockBead | null; right: DockBead | null }>[]>(
    []
  );
  const publishBeads = useCallback(
    (id: string, next: { left: DockBead | null; right: DockBead | null } | null) => {
      setBeadClaims((prev) =>
        withClaim(
          prev,
          id,
          next && (next.left || next.right) ? next : null,
          (a, b) => beadSignature(a) === beadSignature(b)
        )
      );
    },
    []
  );
  const beads = useMemo(() => topClaim(beadClaims) ?? { left: null, right: null }, [beadClaims]);
  const [base, setBase] = useState<DockContext | null>(null);
  const publishBase = useCallback((next: DockContext | null) => {
    setBase((prev) => {
      if (prev === next) return prev;
      if (!prev || !next || prev.kind !== 'desks' || next.kind !== 'desks') return next;
      const same =
        prev.collapsed === next.collapsed &&
        prev.desks.length === next.desks.length &&
        prev.desks.every((d, i) => d.key === next.desks[i].key && d.active === next.desks[i].active);
      return same && prev.onToggleCollapsed === next.onToggleCollapsed ? prev : next;
    });
  }, []);
  // Which card of the stack is in front. It lives here rather than in
  // the dock because screens have to be able to ask for it back - an
  // action that finishes somewhere else (a sort chosen in a menu, a
  // select mode left) should put the path in front again.
  const [face, setFace] = useState<DockFace>('context');
  const [flip, setFlip] = useState<{ face: DockFace; at: number } | null>(null);
  const requestFlip = useCallback((next: DockFace) => setFlip({ face: next, at: Date.now() }), []);
  const [hidden, setHidden] = useState(false);
  const [tabsInFlux, setTabsInFlux] = useState(false);
  const publishTabsInFlux = useCallback((inFlux: boolean) => {
    setTabsInFlux((prev) => (prev === inFlux ? prev : inFlux));
  }, []);
  // The desks swipe having MOVED AT ALL, which is earlier than
  // `tabsInFlux` (that one waits for the halfway mark, where the
  // arriving desk becomes the one being arrived at). Anything that has
  // to be under way before the eye notices the move reads this instead -
  // the path strip's own exit does: "починається вона від початку
  // зміщення в сторону сусіднього робочого столу".
  const [tabsDrifting, setTabsDrifting] = useState(false);
  const publishTabsDrifting = useCallback((drifting: boolean) => {
    setTabsDrifting((prev) => (prev === drifting ? prev : drifting));
  }, []);
  const [prefersActions, setPrefersActions] = useState(false);
  const publishPrefersActions = useCallback((next: boolean) => {
    setPrefersActions((prev) => (prev === next ? prev : next));
  }, []);
  const [wide, setWide] = useState(false);
  const publishWide = useCallback((next: boolean) => {
    setWide((prev) => (prev === next ? prev : next));
  }, []);
  // A new context is a new question, so a context stepped out of does not
  // stay stepped out of once you have gone somewhere else.
  const contextKey = context ? `${context.kind}:${context.icon}` : '';
  useEffect(() => setHidden(false), [contextKey]);
  const value = useMemo(
    () => ({
      face,
      setFace,
      flip,
      requestFlip,
      base,
      publishBase,
      context,
      publish,
      actions,
      publishActions,
      beads,
      publishBeads,
      leave,
      publishLeave,
      topBack,
      publishTopBack,
      topNavUp,
      claimTopNav,
      targets,
      publishTargets,
      hidden,
      setHidden,
      tabsInFlux,
      publishTabsInFlux,
      tabsDrifting,
      publishTabsDrifting,
      prefersActions,
      publishPrefersActions,
      wide,
      publishWide,
    }),
    [
      face,
      flip,
      requestFlip,
      base,
      publishBase,
      context,
      publish,
      actions,
      publishActions,
      beads,
      publishBeads,
      leave,
      publishLeave,
      topBack,
      publishTopBack,
      topNavUp,
      claimTopNav,
      targets,
      publishTargets,
      hidden,
      tabsInFlux,
      publishTabsInFlux,
      tabsDrifting,
      publishTabsDrifting,
      prefersActions,
      publishPrefersActions,
      wide,
      publishWide,
    ]
  );
  return <NavDockContext.Provider value={value}>{children}</NavDockContext.Provider>;
}

// What the dock reads. Null where nothing has been wrapped.
export function useNavDockContext(): DockContext | null {
  const value = useContext(NavDockContext);
  if (!value) return null;
  if (value.hidden) return value.base;
  return value.context ?? value.base;
}

// The screen's OWN context - a path, a run of days - with no fallback to
// the desks. The stack needs them apart: they are two different cards
// now, because the desks vanishing the moment you step into a folder is
// the one thing a navigation dock must never do.
export function useNavDockOwnContext(): DockContext | null {
  return useContext(NavDockContext)?.context ?? null;
}

export function useNavDockDesks(): DockContext | null {
  return useContext(NavDockContext)?.base ?? null;
}

// Whether a context is actually ON SCREEN. This is what the desks ask
// before standing aside - and asking the other question instead is what
// made the dock vanish entirely when a calendar was put away: the
// context still EXISTED, so the desks kept hiding from something nobody
// could see.
export function useNavDockShowing(): boolean {
  const value = useContext(NavDockContext);
  return !!value?.context && !value.hidden;
}

// Whether there IS a context at all, shown or put away - what the desk
// you are standing on asks before offering to bring it back.
export function useNavDockHasContext(): boolean {
  return !!useContext(NavDockContext)?.context;
}

export function useNavDockHidden(): [boolean, (hidden: boolean) => void] {
  const value = useContext(NavDockContext);
  return [value?.hidden ?? false, value?.setHidden ?? (() => {})];
}

// What a screen writes. Publishing null (or unmounting) hands the dock
// back to the desks.
export function useNavDockPublisher() {
  return useContext(NavDockContext)?.publish;
}

// What the dock's crumbs register themselves with, and what a carry
// publishes into. Null where nothing is being carried anywhere.
export function useNavDockTargets(): DockTargets | null {
  return useContext(NavDockContext)?.targets ?? null;
}

export function useNavDockTargetPublisher() {
  return useContext(NavDockContext)?.publishTargets;
}

// What a pushed screen publishes so the dock can carry its way out.
export function useDockLeave(icon: string, onLeave: () => void, enabled = true) {
  const publish = useContext(NavDockContext)?.publishLeave;
  const focused = useIsFocused();
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  // Stable by construction - a fresh handler every render would publish
  // every render, and publishing is a setState above the whole app.
  const stable = useCallback(() => leaveRef.current(), []);
  useEffect(() => {
    if (!publish || !focused || !enabled) return;
    publish({ icon, onLeave: stable });
    return () => publish(null);
  }, [publish, focused, enabled, icon, stable]);
}

// What one of the four desks publishes as its way back, for TopNavBar.
// Same stable-wrapper rule as everything else here: the handler can
// change every render, the published one does not.
export function useTopBack(onPress: (() => void) | null, enabled = true) {
  const publish = useContext(NavDockContext)?.publishTopBack;
  const focused = useIsFocused();
  const ref = useRef(onPress);
  ref.current = onPress;
  const stable = useCallback(() => ref.current?.(), []);
  const dimmed = !onPress;
  useEffect(() => {
    if (!publish || !focused || !enabled) return;
    publish({ onPress: stable, dimmed });
    return () => publish(null);
  }, [publish, focused, enabled, stable, dimmed]);
}

export function useNavTopNavUp(): boolean {
  return useContext(NavDockContext)?.topNavUp ?? false;
}

// Held by a TopNavBar for as long as it is drawn.
export function useTopNavClaim() {
  const claim = useContext(NavDockContext)?.claimTopNav;
  useEffect(() => (claim ? claim() : undefined), [claim]);
}

export function useNavTopBack(): TopBack | null {
  return useContext(NavDockContext)?.topBack ?? null;
}

export function useNavDockLeave(): DockLeave | null {
  return useContext(NavDockContext)?.leave ?? null;
}

// What a screen publishes as its own actions - see DockAction.
//
// The handlers published are STABLE WRAPPERS that call the latest ones
// through a ref. Actions are deduplicated by signature (key, icon,
// active), which is right for redrawing - but a handler can close over
// state the signature knows nothing about, and the dock was then
// keeping the FIRST handler it ever saw. The calendar's "today" bead
// read which card was in front from a closure that was several renders
// old, so its desks/days ring stopped after one step.
export function useDockActions(actions: DockAction[] | null) {
  const publish = useContext(NavDockContext)?.publishActions;
  const focused = useIsFocused();
  const id = useId();
  const ref = useRef(actions);
  ref.current = actions;
  const wrappers = useRef(new Map<string, { onPress: () => void; onLongPress: () => void }>());
  const signature = actionSignature(actions);
  useEffect(() => {
    if (!publish || !focused) return;
    const live = ref.current;
    publish(
      id,
      live
        ? live.map((a) => {
            let w = wrappers.current.get(a.key);
            if (!w) {
              w = {
                onPress: () => ref.current?.find((x) => x.key === a.key)?.onPress(),
                onLongPress: () => ref.current?.find((x) => x.key === a.key)?.onLongPress?.(),
              };
              wrappers.current.set(a.key, w);
            }
            return { ...a, onPress: w.onPress, onLongPress: a.onLongPress ? w.onLongPress : undefined };
          })
        : null
    );
    return () => publish(id, null);
  }, [publish, focused, signature, id]);
}

export function useNavDockActions(): DockAction[] | null {
  return useContext(NavDockContext)?.actions ?? null;
}

// The two fixed beads either side of the stack - see DockBead. Same
// stable-wrapper rule as the actions, for the same reason.
export function useDockBeads(left: DockBead | null, right: DockBead | null) {
  const publish = useContext(NavDockContext)?.publishBeads;
  const focused = useIsFocused();
  const id = useId();
  const ref = useRef({ left, right });
  ref.current = { left, right };
  const wrap = useRef({
    left: { onPress: () => ref.current.left?.onPress(), onLongPress: () => ref.current.left?.onLongPress?.() },
    right: { onPress: () => ref.current.right?.onPress(), onLongPress: () => ref.current.right?.onLongPress?.() },
  });
  const signature = beadSignature({ left, right });
  useEffect(() => {
    if (!publish || !focused) return;
    const { left: l, right: r } = ref.current;
    publish(id, {
      left: l ? { ...l, onPress: wrap.current.left.onPress, onLongPress: l.onLongPress ? wrap.current.left.onLongPress : undefined } : null,
      right: r ? { ...r, onPress: wrap.current.right.onPress, onLongPress: r.onLongPress ? wrap.current.right.onLongPress : undefined } : null,
    });
    return () => publish(id, null);
  }, [publish, focused, signature, id]);
}

export function useNavDockBeads() {
  return useContext(NavDockContext)?.beads ?? { left: null, right: null };
}

// Whether a swipe has visually settled on a new desk that
// react-navigation does not know about yet - see the field's own
// comment on Value. Read by ContextDock, written by FloatingIslandTabBar.
export function useNavDockTabsInFlux(): boolean {
  return useContext(NavDockContext)?.tabsInFlux ?? false;
}

export function useDockTabsInFluxPublisher() {
  return useContext(NavDockContext)?.publishTabsInFlux;
}

export function useDockTabsDriftPublisher() {
  return useContext(NavDockContext)?.publishTabsDrifting;
}

export function useNavDockTabsDrifting(): boolean {
  return useContext(NavDockContext)?.tabsDrifting ?? false;
}

// The desks, published by the tab bar - see DockDesk.
export function useDockBase(base: DockContext | null) {
  const publish = useContext(NavDockContext)?.publishBase;
  const ref = useRef(base);
  ref.current = base;
  const signature =
    base?.kind === 'desks'
      ? `${base.collapsed}|${base.desks.map((d) => `${d.key}:${d.active ? 1 : 0}`).join(',')}`
      : '';
  useEffect(() => {
    if (!publish) return;
    publish(ref.current);
    return () => publish(null);
  }, [publish, signature]);
}

// Which card of the stack is in front, and how to change it.
// What the DOCK reads: the standing request, if any.
export function useNavDockFlipRequest(): { face: DockFace; at: number } | null {
  return useContext(NavDockContext)?.flip ?? null;
}

// What a SCREEN calls: turn the dock to that card, visibly.
export function useNavDockFlip(): (face: DockFace) => void {
  const request = useContext(NavDockContext)?.requestFlip;
  return useCallback((next: DockFace) => request?.(next), [request]);
}

export function useNavDockFace(): [DockFace, (face: DockFace) => void] {
  const value = useContext(NavDockContext);
  return [value?.face ?? 'context', value?.setFace ?? (() => {})];
}

// See `prefersActions`. Published while focused, cleared on the way out,
// so the preference never outlives the screen that holds it.
export function useDockOpensOnActions(prefers: boolean) {
  const publish = useContext(NavDockContext)?.publishPrefersActions;
  const focused = useIsFocused();
  useEffect(() => {
    if (!publish) return;
    publish(focused && prefers);
    return () => publish(false);
  }, [publish, focused, prefers]);
}

export function useNavDockPrefersActions(): boolean {
  return useContext(NavDockContext)?.prefersActions ?? false;
}

// See `wide`. Published while focused and cleared on the way out, so a
// screen left mid-selection does not hand the next one a stretched dock.
export function useDockWide(wide: boolean) {
  const publish = useContext(NavDockContext)?.publishWide;
  const focused = useIsFocused();
  useEffect(() => {
    if (!publish) return;
    publish(focused && wide);
    return () => publish(false);
  }, [publish, focused, wide]);
}

export function useNavDockWide(): boolean {
  return useContext(NavDockContext)?.wide ?? false;
}

// What a screen calls when an action has FINISHED somewhere else - a
// sort picked from its menu, a select mode left, a folder named. The
// card of actions was opened for one thing; once that thing is done,
// where-you-are is what belongs in front.
export function useDockShowContext(): () => void {
  const setFace = useContext(NavDockContext)?.setFace;
  return useCallback(() => setFace?.('context'), [setFace]);
}
