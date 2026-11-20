import { RefObject } from 'react';
import { View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

// Mouse and trackpad zoom for the board. Nothing to do on a phone, where
// two fingers already say it - see the .web sibling, which is the whole
// implementation.

export type CanvasWheelHandles = {
  scale: SharedValue<number>;
  savedScale: SharedValue<number>;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  savedTranslateX: SharedValue<number>;
  savedTranslateY: SharedValue<number>;
  viewport: { width: number; height: number };
  minScale: number;
  maxScale: number;
};

export function useCanvasWheel(_ref: RefObject<View | null>, _handles: CanvasWheelHandles): void {}
