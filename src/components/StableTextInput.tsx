import { forwardRef, useRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

// A TEXT FIELD THAT KEEPS ITS CARET (2026-10-09, the user's: deleting text
// sometimes sent the cursor a character back from the end - the same jumping
// the chat once had). A controlled multiline input on Android hands every
// keystroke to the parent, which sets the value back a render later; with a
// keyboard that is still composing (Gboard's prediction, a long word being
// deleted) that second write lands after the next key and the caret slips.
// Here the native field owns the text while it is typed in: `value` is only
// the starting text, and it is written back into the field ONLY when it is
// changed from outside (a sheet reopened for another card) - and that is done
// by giving the field a fresh key, never by writing into a field in use.
const StableTextInput = forwardRef<
  TextInput,
  Omit<TextInputProps, 'value' | 'defaultValue' | 'onChangeText'> & {
    value: string;
    onChangeText: (text: string) => void;
  }
>(function StableTextInput({ value, onChangeText, ...rest }, ref) {
  // What the field itself last said. A `value` equal to it is the field's own
  // text coming back and changes nothing; a different one came from outside.
  const said = useRef(value);
  const epoch = useRef(0);
  if (value !== said.current) {
    said.current = value;
    epoch.current += 1;
  }
  return (
    <TextInput
      key={epoch.current}
      ref={ref}
      defaultValue={value}
      onChangeText={(text) => {
        said.current = text;
        onChangeText(text);
      }}
      {...rest}
    />
  );
});

export default StableTextInput;
