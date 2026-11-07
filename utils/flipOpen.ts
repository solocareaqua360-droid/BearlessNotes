import { Platform, type View } from "react-native";
import { makeMutable } from "react-native-reanimated";

// CARD FLIP-OPEN (ported from mindEva). The REAL card turns edge-on in the
// first half of one shared clock; in the second half the window comes round
// from the card's place. A photograph of the card was tried and looked like
// "another card" at the hand-over, so there is none.
export type FlipFrom = { rect: { x: number; y: number; width: number; height: number } };
export const FLIP_MS = 460;
/** 0 = the card .. 1 = the window; driven by FlipLayer. */
export const flipProgress = makeMutable(0);
/** Which card is turning ('' = none). */
export const flipKey = makeMutable("");

export function prepareFlip(key: string, node: View | null): Promise<FlipFrom | null> {
  if (Platform.OS === "web" || !node) return Promise.resolve(null);
  return new Promise((resolve) => {
    node.measureInWindow((x, y, width, height) => {
      if (!(width > 0 && height > 0)) return resolve(null);
      flipProgress.value = 0;
      flipKey.value = key;
      resolve({ rect: { x, y, width, height } });
    });
  });
}

export const endFlip = () => {
  flipKey.value = "";
};
