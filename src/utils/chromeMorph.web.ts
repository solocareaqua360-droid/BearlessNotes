import type { View } from 'react-native';
import { makeMutable } from 'react-native-reanimated';
import type { Rect } from './morph';

// The phone's chrome morph (see the native sibling). The laptop moves its
// chrome with view transitions; here everything is inert.
export type Part = 'bar' | 'dock';
export type Side = 'list' | 'note';
export type Shot = { uri: string; rect: Rect };
export type Shots = { bar: Partial<Record<Side, Shot>>; dock: Partial<Record<Side, Shot>> };

export const chromeT = makeMutable(0);
export const chromeCover = makeMutable(0);

export function chromeNodeRef(_part: Part, _side: Side): ((node: View | null) => void) | undefined {
  return undefined;
}
export function useChromeMorph(): { active: boolean; shots: Shots } {
  return { active: false, shots: { bar: {}, dock: {} } };
}
export function pictureLoaded(_uri: string): void {}
export async function chromeOpenBegin(): Promise<boolean> {
  return false;
}
export async function chromeOpenArrive(): Promise<void> {}
export async function chromeBackBegin(): Promise<boolean> {
  return false;
}
export async function chromeEnd(_waitFor?: Side): Promise<void> {}
export function chromeAbort(): void {}
