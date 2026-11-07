import { TextInput as RNTextInput } from 'react-native';

// The browser has no composing-keyboard write-back problem (see AppTextInput.tsx): react-native-web's own field.
const TextInput = RNTextInput;
type TextInput = RNTextInput;

export default TextInput;
