import { forwardRef, useCallback, useLayoutEffect, useRef } from 'react';
import {
  TextInput as RNTextInput,
  type NativeSyntheticEvent,
  type TextInputChangeEventData,
  type TextInputProps,
  type TextInputSelectionChangeEventData,
} from 'react-native';
// The native field's own «set this text» command - what React Native's own TextInput sends for a controlled value.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - a deep import with no type declarations
import { Commands } from 'react-native/Libraries/Components/TextInput/AndroidTextInputNativeComponent';

// EVERY TEXT FIELD IN THE APP (2026-10-28, the user: «раз і назавжди вирішити цю проблему по всьому застосунку» -
// typing at the START of a field came out backwards, in the coordinates window and in «Думки»; StableTextInput had
// fixed it in six places only). A controlled TextInput on Android hands each keystroke to JS, and React Native writes
// the value back into the field a render later; while the keyboard is still composing a word (the underline), that
// write lands after the next key and the caret jumps to the start. Here the native field owns its text while it is
// typed in: `value` only seeds it, and is written into the field ONLY when it differs from what the field itself last
// said - a screen that clears, fills or rejects the text. Imported everywhere in place of react-native's TextInput.
type Props = TextInputProps;

const TextInput = forwardRef<RNTextInput, Props>(function AppTextInput(props, ref) {
  const { value, defaultValue, onChange, onChangeText, onSelectionChange, ...rest } = props;
  const controlled = typeof value === 'string';
  const inner = useRef<RNTextInput | null>(null);
  // What the field last said, the newest `value` given, the field's event count and where its caret stood.
  const said = useRef<string>(controlled ? (value as string) : (defaultValue ?? ''));
  const latest = useRef(value);
  latest.current = value;
  const eventCount = useRef(0);
  const caret = useRef<{ start: number; end: number } | null>(null);
  const seed = useRef(controlled ? value : defaultValue);

  const push = useCallback((text: string) => {
    const host = inner.current;
    if (!host) return;
    // Where the caret was, moved by however much shorter or longer the text became; else the end.
    const shift = text.length - said.current.length;
    const at = caret.current ? Math.max(0, Math.min(text.length, caret.current.end + shift)) : text.length;
    said.current = text;
    try {
      Commands.setTextAndSelection(host, eventCount.current, text, at, at);
    } catch {
      // A field already gone - nothing to write into.
    }
  }, []);

  // A value set from outside (cleared after sending, filled from a picker, a reopened card).
  useLayoutEffect(() => {
    if (controlled && value !== said.current) push(value as string);
  });

  const setRef = useCallback(
    (node: RNTextInput | null) => {
      inner.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<RNTextInput | null>).current = node;
    },
    [ref]
  );

  return (
    <RNTextInput
      ref={setRef}
      {...rest}
      defaultValue={seed.current}
      onChange={(e: NativeSyntheticEvent<TextInputChangeEventData>) => {
        eventCount.current = e.nativeEvent.eventCount;
        onChange?.(e);
      }}
      onChangeText={(text) => {
        said.current = text;
        onChangeText?.(text);
        if (!controlled) return;
        // A screen that keeps the old text (a filter, a limit) may not render again at all - then the field is set
        // back here, once the screen has had its say.
        setTimeout(() => {
          const now = latest.current;
          if (typeof now === 'string' && now !== said.current) push(now);
        }, 0);
      }}
      onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        caret.current = e.nativeEvent.selection;
        onSelectionChange?.(e);
      }}
    />
  );
}) as unknown as typeof RNTextInput;
// TextInput.State (the focused field) is react-native's own.
Object.assign(TextInput, { State: RNTextInput.State });

// The same name as a type, so `useRef<TextInput>(null)` keeps working where it is imported.
type TextInput = RNTextInput;

export default TextInput;
