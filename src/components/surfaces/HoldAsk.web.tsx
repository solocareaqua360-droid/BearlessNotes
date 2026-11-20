import type { View } from 'react-native';
import { ask, type AskOptions } from './Ask';

// The laptop holds nothing: a right click's menu already stands at the
// pointer (see Ask and contextPoint), so a hold's question is ask().
export function holdAsk(options: AskOptions, _node?: View | null): Promise<string> {
  return ask(options);
}

export function HoldAskHost() {
  return null;
}
