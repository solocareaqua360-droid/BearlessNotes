import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Haptic feedback, named for what happened rather than for how it should
// feel. Android has its own semantic set (HapticFeedbackConstants, exposed
// as performAndroidHapticsAsync) that the system renders with effects tuned
// for the actual device - which is why "drag start" reads as a crisp tick
// rather than the buzz a raw Vibration.vibrate(ms) gives. iOS has no such
// set, so each falls back to the closest impact style.
//
// Every call is fire-and-forget and swallows its own errors: a device with
// no vibrator (or with system haptics switched off) must never turn a
// gesture into a crash.
function android(type: Haptics.AndroidHaptics, iosFallback: () => Promise<void>) {
  const run = Platform.OS === 'android' ? Haptics.performAndroidHapticsAsync(type) : iosFallback();
  run.catch(() => {});
}

// A long press has been held long enough and the block is now lifted -
// the moment the gesture is "taken", which until now was only visible.
export function hapticPickUp() {
  android(Haptics.AndroidHaptics.Drag_Start, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

// The drop line has snapped to a different gap. Clock_Tick on purpose:
// dragging past the blocks should feel like winding a mechanical watch,
// one notch at a time - so this has to stay the lightest of the three.
export function hapticSnapTick() {
  android(Haptics.AndroidHaptics.Clock_Tick, () => Haptics.selectionAsync());
}

// Released, and the order actually changed. Nothing fires when a block is
// dropped back where it started - there'd be nothing to confirm.
export function hapticDrop() {
  android(Haptics.AndroidHaptics.Gesture_End, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
