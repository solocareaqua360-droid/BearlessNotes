import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import {
  GLASS_BACKDROP,
  GLASS_BODY,
  GLASS_CARD,
  GLASS_DANGER,
  GLASS_EDGE,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_MUTED,
} from '../../constants/glass';
import { hapticButtonDown } from '../../utils/haptics';

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

type Pending = AskOptions & { resolve: (id: string) => void };

let queue: Pending[] = [];
let listener: (() => void) | null = null;

function announce() {
  listener?.();
}

// Ask, and wait for the answer. Resolves with the chosen action's id, or
// 'cancel' if it was dismissed.
export function ask(options: AskOptions): Promise<string> {
  return new Promise((resolve) => {
    queue = [...queue, { ...options, resolve }];
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
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<Pending | null>(null);

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
  const cancelLabel = current.cancelLabel === undefined ? 'Скасувати' : current.cancelLabel;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => answer('cancel')}>
      <View style={styles.backdrop}>
        {/* The dim is the way out, the same as tapping Скасувати. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={() => answer('cancel')} />
        <View style={[styles.card, { marginBottom: insets.bottom }]}>
          <Text style={styles.title}>{current.title}</Text>
          {!!current.message && <Text style={styles.message}>{current.message}</Text>}

          <View style={styles.actions}>
            {current.actions.map((action) => {
              const danger = action.tone === 'danger';
              const primary = action.tone === 'primary';
              return (
                <Pressable
                  key={action.id}
                  style={({ pressed }) => [
                    styles.action,
                    primary && styles.actionPrimary,
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
                      color={primary ? '#171310' : danger ? GLASS_DANGER : GLASS_TEXT}
                    />
                  )}
                  <View style={styles.actionText}>
                    <Text
                      style={[
                        styles.actionLabel,
                        danger && styles.actionLabelDanger,
                        primary && styles.actionLabelPrimary,
                      ]}
                    >
                      {action.label}
                    </Text>
                    {!!action.hint && (
                      <Text style={[styles.actionHint, primary && styles.actionHintPrimary]}>
                        {action.hint}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {cancelLabel !== null && (
            <Pressable
              style={({ pressed }) => [styles.cancel, pressed && styles.actionPressed]}
              onPress={() => answer('cancel')}
            >
              <Text style={styles.cancelLabel}>{cancelLabel}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: GLASS_BACKDROP,
    justifyContent: 'flex-end',
    padding: 16,
  },
  // Sitting at the bottom, within reach of a thumb, rather than floating
  // in the middle of a six-inch screen where nothing can be reached.
  card: {
    borderRadius: 28,
    backgroundColor: GLASS_BODY,
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
