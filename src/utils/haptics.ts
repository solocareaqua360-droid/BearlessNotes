import { Platform, Vibration } from 'react-native';
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

// A checkbox (a document's checkbox block, a task) changed state. Two
// different effects on purpose - ticking something off should not feel the
// same as un-ticking it.
export function hapticToggle(on: boolean) {
  android(on ? Haptics.AndroidHaptics.Toggle_On : Haptics.AndroidHaptics.Toggle_Off, () =>
    Haptics.impactAsync(on ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light)
  );
}

// Select mode turned on or off - a mode change, so heavier than the ticks
// that follow inside it.
export function hapticSelectMode() {
  android(Haptics.AndroidHaptics.Context_Click, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid));
}

// One item checked/unchecked while in select mode. The lightest effect
// available: a bulk selection is often a dozen taps in a row.
export function hapticSelectItem() {
  android(Haptics.AndroidHaptics.Segment_Tick, () => Haptics.selectionAsync());
}

// An operation finished and produced something - a group imported onto a
// board, a record saved.
export function hapticSuccess() {
  android(Haptics.AndroidHaptics.Confirm, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

// Something was destroyed or refused - a delete, or a limit that stopped
// the tap from doing anything.
export function hapticWarning() {
  android(Haptics.AndroidHaptics.Reject, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

// A new document created. Deliberately the SAME effect as picking a block
// up, not one of its own: a composed two-pulse "page turn" was
// imperceptible through the system's tactile effects on the user's
// Samsung (which attenuates them heavily), and buzzy through the raw
// motor. The drag effect is what reads clearly on that hardware, so a
// creation gets it too.
export function hapticCreate() {
  android(Haptics.AndroidHaptics.Drag_Start, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

// Something thrown away. The raw motor, not the tactile effects the rest
// of this file uses - and that is the whole point.
//
// Two earlier attempts built this out of a series of discrete impacts,
// fading first by strength and then by spacing. Both came through as
// separate knocks; the user's words for the second were "an old car
// starting", which is exactly what a run of evenly-spaced taps is. No
// amount of retiming fixes that: discrete effects can't be made
// continuous, and a whoosh IS continuous.
//
// The motor can be. This pattern never fully stops - the vibration
// shortens (70ms down to 8) while the gaps between grow (10ms up to 20),
// so it reads as one sound fading out rather than as several. It buzzes
// where a haptic effect taps, which for paper going into a bin is the
// right texture anyway. Android's format alternates pause/vibrate.
export function hapticDiscard() {
  Vibration.vibrate([0, 70, 10, 50, 12, 36, 14, 26, 16, 18, 18, 12, 20, 8]);
}
