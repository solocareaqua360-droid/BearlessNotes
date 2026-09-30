import { useLift } from '../../theme/ThemeProvider';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import GlassLayer from '../GlassLayer';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import {
  GLASS_BODY_BLURRED,
  GLASS_CARD,
  GLASS_DANGER,
  GLASS_EDGE,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_MUTED,
  SHEET_FRAME,
  SHEET_WINDOW,
} from '../../constants/glass';
import { hapticButtonDown } from '../../utils/haptics';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { useNavChromeStyle } from '../../navigation/navDock';
import { useSoft } from '../../theme/soft';
import { takeRecentClickPoint, takeRecentContextPoint, type ContextPoint } from '../../utils/contextPoint';
import { useWindowDimensions } from 'react-native';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { useDensity } from '../../hooks/useDensity';

// «Питання» - the first of the named surfaces.
//
// One window for everything the app has to ask before it acts: delete,
// overwrite, replace, "as a photo or as a PDF". Until now every one of
// those was the system's own Alert - a white card in a dark app, with the
// system's typeface, and a hard limit of three buttons on Android beyond
// which the fourth is dropped in silence (that is how "Фото + текст" went
// missing). Fifty-eight of them across eighteen files.
//
// Two things make this one different in kind, not just in colour: the
// actions are ROWS, so there can be as many as the question needs, and it
// answers with a promise, so asking reads as one line at the place that
// wanted to know.

export type AskTone = 'normal' | 'primary' | 'danger';

export type AskAction = {
  // What comes back from ask(). Any string; 'cancel' is what a dismissal
  // resolves to, so it is worth reusing for the way out.
  id: string;
  label: string;
  hint?: string;
  tone?: AskTone;
  icon?: keyof typeof Ionicons.glyphMap;
};

export type AskOptions = {
  title: string;
  message?: string;
  actions: AskAction[];
  // The row that closes it without doing anything. Left out entirely by
  // passing null - for a question that cannot be walked away from.
  cancelLabel?: string | null;
};

type Pending = AskOptions & {
  resolve: (id: string) => void;
  anchor: ContextPoint | null;
  // Where the left button was pressed just before - see AskHost.
  clickAnchor: ContextPoint | null;
};

let queue: Pending[] = [];
let listener: (() => void) | null = null;

function announce() {
  listener?.();
}

// Ask, and wait for the answer. Resolves with the chosen action's id, or
// 'cancel' if it was dismissed.
export function ask(options: AskOptions): Promise<string> {
  // Straight out of a right click: it stands at the pointer, small.
  const anchor = takeRecentContextPoint();
  const clickAnchor = takeRecentClickPoint();
  return new Promise((resolve) => {
    queue = [...queue, { ...options, resolve, anchor, clickAnchor }];
    announce();
  });
}

// The two shapes almost every call site actually wants.
export function confirm(options: {
  title: string;
  message?: string;
  confirmLabel: string;
  tone?: AskTone;
}): Promise<boolean> {
  return ask({
    title: options.title,
    message: options.message,
    actions: [{ id: 'ok', label: options.confirmLabel, tone: options.tone ?? 'danger' }],
  }).then((id) => id === 'ok');
}

// Something to say, nothing to decide.
export function notify(title: string, message?: string): Promise<string> {
  return ask({ title, message, actions: [], cancelLabel: 'Зрозуміло' });
}

// Mounted once, at the root. Everything above is a function call from
// anywhere in the app, which is the whole point: a question should not
// need a piece of state on the screen that happens to be asking.
export function AskHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  // A question has nothing to type into, so the keyboard the asking screen
  // left up goes down - and while it is going, the window is centred in
  // what the keyboard still covers, not under it.
  const keyboardHeight = useKeyboardHeight();
  // What parts this window from the screen behind it - the glow in the
  // black theme, a shadow in the white one, nothing in the colour one,
  // where the glass already does the job.
  const lift = useLift();
  // THE SOFT QUESTION: asked from a screen that wears the soft style (the
  // note's "/" menu, a confirmation on the Documents desk), the card
  // wears it too - its quiet surface, Inter, answers as soft tints -
  // instead of the dark glass every other screen still asks in.
  const chromeStyle = useNavChromeStyle();
  const softTokens = useSoft();
  const S = chromeStyle === 'soft' ? softTokens : null;
  const softDanger = S ? (S.dark ? '#FF7A6E' : '#C8452F') : null;
  const pointer = useDensity() === 'pointer';
  useEffect(() => {
    if (current) Keyboard.dismiss();
  }, [current]);

  useEffect(() => {
    // Questions can collide - a bulk delete that reports its failure, for
    // instance - so they wait their turn rather than overwrite each other.
    const take = () => setCurrent((shown) => shown ?? queue[0] ?? null);
    listener = take;
    take();
    return () => {
      listener = null;
    };
  }, []);

  function answer(id: string) {
    if (!current) return;
    queue = queue.filter((item) => item !== current);
    current.resolve(id);
    setCurrent(null);
    // Straight on to the next one, if the same moment raised two.
    setTimeout(() => setCurrent(queue[0] ?? null), 0);
  }

  if (!current) return null;
  const isConfirmation = current.actions.length <= 2 && current.actions.every((a) => !a.icon && !a.hint);
  // Asked by a right click: not a window over the whole screen but a small
  // menu at the cursor.
  if (current.anchor && !(pointer && isConfirmation)) {
    return (
      <AskPopover
        title={current.title}
        message={current.message}
        actions={current.actions}
        at={current.anchor}
        onAnswer={answer}
        tokens={softTokens}
      />
    );
  }
  // At a pointer, a question with a list of answers is a menu too: beside
  // the click that asked it, or, asked by nothing on screen, in the middle.
  if (pointer && !isConfirmation) {
    return (
      <AskPopover
        title={current.title}
        message={current.message}
        actions={current.actions}
        at={current.clickAnchor}
        onAnswer={answer}
        tokens={softTokens}
      />
    );
  }
  const cancelLabel = current.cancelLabel === undefined ? 'Скасувати' : current.cancelLabel;
  // At a pointer, a confirmation - one or two plain answers, no icons, no
  // hints - is a Mac's alert, not a phone's sheet.
  if (pointer && isConfirmation) {
    return (
      <MacAlert
        title={current.title}
        message={current.message}
        actions={current.actions}
        cancelLabel={cancelLabel}
        onAnswer={answer}
        tokens={softTokens}
      />
    );
  }

  return (
    // A layer, not a window. The blur on Android only reaches what is
    // inside its own window, and a Modal is a window of its own - which
    // is why every sheet here stopped being one. The dim, the tap that
    // closes and the hardware back button all come with the layer.
    <GlassLayer visible onClose={() => answer('cancel')} intensity={60}>
      <View style={[styles.frame, { paddingBottom: keyboardHeight }]} pointerEvents="box-none">
      <View
        style={[
          styles.card,
          S ? { backgroundColor: S.card, borderWidth: 0, borderRadius: 28, boxShadow: S.popShadow } : lift,
        ]}
      >
        <Text style={[styles.title, S && { fontFamily: SOFT_SEMIBOLD, fontWeight: 'normal', letterSpacing: -0.3, fontSize: 20, color: S.ink }]}>
          {current.title}
        </Text>
        {!!current.message && (
          <Text style={[styles.message, S && { fontFamily: SOFT_REGULAR, color: S.ink2 }]}>{current.message}</Text>
        )}

        {/* Scrolls once there are more answers than fit. The rows were a
            plain column, which is right for the four or five a question
            usually has - but a question whose answers are the user's own
            databases has as many as they have made, and the last ones
            were simply off the bottom of the screen. */}
        <ScrollView
          style={styles.actionsScroll}
          contentContainerStyle={styles.actions}
          keyboardShouldPersistTaps="handled"
        >
          {current.actions.map((action) => {
            const danger = action.tone === 'danger';
            const primary = action.tone === 'primary';
            return (
              <Pressable
                key={action.id}
                style={({ pressed }) => [
                  styles.action,
                  S && { backgroundColor: S.fill, borderRadius: 18 },
                  primary && (S ? { backgroundColor: S.ink } : styles.actionPrimary),
                  pressed && styles.actionPressed,
                ]}
                onPress={() => {
                  hapticButtonDown();
                  answer(action.id);
                }}
              >
                {!!action.icon && (
                  <Ionicons
                    name={action.icon}
                    size={20}
                    color={
                      S
                        ? primary
                          ? S.card
                          : danger
                            ? softDanger!
                            : S.ink2
                        : primary
                          ? '#171310'
                          : danger
                            ? GLASS_DANGER
                            : GLASS_TEXT
                    }
                  />
                )}
                <View style={styles.actionText}>
                  <Text
                    style={[
                      styles.actionLabel,
                      S && { fontFamily: SOFT_MEDIUM, fontWeight: 'normal', color: S.ink },
                      danger && (S ? { color: softDanger! } : styles.actionLabelDanger),
                      primary && (S ? { color: S.card } : styles.actionLabelPrimary),
                    ]}
                  >
                    {action.label}
                  </Text>
                  {!!action.hint && (
                    <Text
                      style={[
                        styles.actionHint,
                        S && { fontFamily: SOFT_REGULAR, color: S.ink3 },
                        primary && (S ? { color: S.card, opacity: 0.7 } : styles.actionHintPrimary),
                      ]}
                    >
                      {action.hint}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {cancelLabel !== null && (
          <Pressable
            style={({ pressed }) => [styles.cancel, S && { borderTopWidth: 0 }, pressed && styles.actionPressed]}
            onPress={() => answer('cancel')}
          >
            <Text style={[styles.cancelLabel, S && { fontFamily: SOFT_MEDIUM, fontWeight: 'normal', color: S.ink2 }]}>
              {cancelLabel}
            </Text>
          </Pressable>
        )}
      </View>
      </View>
    </GlassLayer>
  );
}

// A MAC'S ALERT (the laptop's confirmation): a small window over a barely
// dimmed app - no blur, nothing drawn edge to edge - its answers as buttons
// in a row at the bottom right, the way macOS lays them out: the way out
// first, the action last and filled. Return answers the action, Esc walks
// away. A click beside it does nothing, as on a Mac: a question that
// matters is not dismissed by a stray click.
function MacAlert({
  title,
  message,
  actions,
  cancelLabel,
  onAnswer,
  tokens: S,
}: {
  title: string;
  message?: string;
  actions: AskAction[];
  cancelLabel: string | null;
  onAnswer: (id: string) => void;
  tokens: ReturnType<typeof useSoft>;
}) {
  const danger = S.dark ? '#FF7A6E' : '#C8452F';
  // What Return does: the last action - or, with none, the way out.
  const main = actions[actions.length - 1]?.id ?? 'cancel';
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && cancelLabel !== null) {
        event.preventDefault();
        onAnswer('cancel');
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onAnswer(main);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const button = (id: string, label: string, tone: AskTone | 'cancel') => {
    const filled = id === main;
    const background = !filled ? S.fill : tone === 'danger' ? danger : S.ink;
    const color = !filled ? S.ink : S.dark && tone !== 'danger' ? S.bg : '#FFFFFF';
    return (
      <Pressable
        key={id}
        onPress={() => onAnswer(id)}
        style={(state) => [
          styles.alertButton,
          { backgroundColor: background },
          (state as { hovered?: boolean }).hovered && { opacity: 0.85 },
        ]}
      >
        <Text style={[styles.alertButtonLabel, { color }]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.alertFrame} pointerEvents="box-none">
      <View style={styles.alertDim} />
      <View
        style={[
          styles.alert,
          { backgroundColor: S.card, boxShadow: S.popShadow, borderColor: S.line },
        ]}
      >
        <Text style={[styles.alertTitle, { color: S.ink }]}>{title}</Text>
        {!!message && <Text style={[styles.alertMessage, { color: S.ink2 }]}>{message}</Text>}
        <View style={styles.alertButtons}>
          {cancelLabel !== null && actions.length > 0 && button('cancel', cancelLabel, 'cancel')}
          {actions.map((a) => button(a.id, a.label, a.tone ?? 'normal'))}
          {actions.length === 0 && cancelLabel !== null && button('cancel', cancelLabel, 'primary')}
        </View>
      </View>
    </View>
  );
}

// THE SMALL MENU AT THE CURSOR - the same question, drawn the way a right
// click's own menu is: rows 30 tall, the name of what was clicked as a quiet
// header, no cancel row (the click beside it, or Esc, is the cancel).
function AskPopover({
  title,
  message,
  actions,
  at,
  onAnswer,
  tokens: S,
}: {
  title: string;
  message?: string;
  actions: AskAction[];
  // Null: asked by nothing on screen - it stands in the middle, over a
  // barely dimmed app, like the alert.
  at: ContextPoint | null;
  onAnswer: (id: string) => void;
  tokens: ReturnType<typeof useSoft>;
}) {
  const { width, height } = useWindowDimensions();
  const danger = S.dark ? '#FF7A6E' : '#C8452F';
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onAnswer('cancel');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const MENU_W = 244;
  const estimate = 30 + (message ? 34 : 0) + actions.reduce((sum, a) => sum + (a.hint ? 44 : 30), 0) + 12;
  const left = at ? Math.max(8, Math.min(at.x, width - MENU_W - 8)) : Math.max(8, (width - MENU_W) / 2);
  const top = at ? Math.max(8, Math.min(at.y, height - estimate - 8)) : Math.max(8, (height - estimate) / 2);
  return (
    <View style={styles.popoverFrame} pointerEvents="box-none">
      {/* A sheet that catches the click away - and the second right click,
          which closes this menu instead of opening the browser's. */}
      <Pressable
        style={[styles.popoverScrim, !at && { backgroundColor: 'rgba(0,0,0,0.12)' }]}
        onPress={() => onAnswer('cancel')}
        {...({ onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault() } as object)}
      />
      <View
        style={[
          styles.popover,
          { left, top, width: MENU_W, backgroundColor: S.card, boxShadow: S.popShadow, borderColor: S.line },
        ]}
      >
        <Text style={[styles.popoverTitle, { color: S.ink3 }]} numberOfLines={1}>
          {title}
        </Text>
        {!!message && <Text style={[styles.popoverMessage, { color: S.ink2 }]}>{message}</Text>}
        {actions.map((action) => {
          const isDanger = action.tone === 'danger';
          return (
            <Pressable
              key={action.id}
              onPress={() => onAnswer(action.id)}
              style={(state) => [
                styles.popoverRow,
                (state as { hovered?: boolean }).hovered && { backgroundColor: S.fill },
              ]}
            >
              {!!action.icon && <Ionicons name={action.icon} size={15} color={isDanger ? danger : S.ink2} />}
              <View style={styles.popoverText}>
                <Text style={[styles.popoverLabel, { color: isDanger ? danger : S.ink }]} numberOfLines={1}>
                  {action.label}
                </Text>
                {!!action.hint && (
                  <Text style={[styles.popoverHint, { color: S.ink3 }]} numberOfLines={1}>
                    {action.hint}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  popoverFrame: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 } as never,
  alertFrame: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, alignItems: 'center', justifyContent: 'center' } as never,
  alertDim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.12)' },
  alert: { width: 380, maxWidth: '90%', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 20, paddingBottom: 16, gap: 6 },
  alertTitle: { fontSize: 14.5, fontFamily: SOFT_SEMIBOLD },
  alertMessage: { fontSize: 13, lineHeight: 18, fontFamily: SOFT_REGULAR },
  alertButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  alertButton: { minWidth: 88, height: 30, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  alertButtonLabel: { fontSize: 13, fontFamily: SOFT_MEDIUM },
  popoverScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  popover: { position: 'absolute', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 5 },
  popoverTitle: { fontSize: 12, fontFamily: SOFT_MEDIUM, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 },
  popoverMessage: { fontSize: 12.5, fontFamily: SOFT_REGULAR, paddingHorizontal: 10, paddingBottom: 6 },
  popoverRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 30, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7 },
  popoverText: { flex: 1 },
  popoverLabel: { fontSize: 13.5, fontFamily: SOFT_MEDIUM },
  popoverHint: { fontSize: 11.5, fontFamily: SOFT_REGULAR },
  frame: SHEET_FRAME,
  card: {
    ...SHEET_WINDOW,
    maxHeight: '80%',
    // Lighter than an unblurred sheet: at the opaque strength the blur
    // underneath stops showing through at all.
    backgroundColor: GLASS_BODY_BLURRED,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
    paddingTop: 22,
    paddingBottom: 12,
    paddingHorizontal: 12,
    gap: 6,
  },
  title: {
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    paddingHorizontal: 10,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    paddingHorizontal: 10,
    paddingTop: 2,
  },
  actionsScroll: {
    flexGrow: 0,
  },
  actions: {
    gap: 6,
    paddingTop: 14,
  },
  // A row, not a button in a row of buttons: that is what lets a question
  // have four answers, or six, and still be read top to bottom.
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: GLASS_CARD,
  },
  actionPrimary: {
    backgroundColor: '#F5C77E',
  },
  actionPressed: {
    opacity: 0.6,
  },
  actionText: {
    flex: 1,
    gap: 2,
  },
  actionLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  actionLabelDanger: {
    color: GLASS_DANGER,
  },
  actionLabelPrimary: {
    color: '#171310',
  },
  actionHint: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
  },
  actionHintPrimary: {
    color: 'rgba(23,19,16,0.7)',
  },
  cancel: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: GLASS_LINE,
  },
  cancelLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
});
