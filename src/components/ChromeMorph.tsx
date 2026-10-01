import { Image, StyleSheet, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useSoft } from '../theme/soft';
import { chromeT, pictureLoaded, useChromeMorph, type Shot } from '../utils/chromeMorph';

// THE STAND-IN for the dock and the top bar while a page grows out of its
// card or folds back into it - utils/chromeMorph tells the whole story.
// Mounted once at the app's root, over everything; draws nothing at rest.

// The list's dock: a field, then this gap, then a round button this wide
// (ContextDock's soft compact branch: gap 10, TWO_BEAD 56).
const DOCK_GAP = 10;
const BUTTON = 56;

const lerp = (a: number, b: number, k: number) => {
  'worklet';
  return a + (b - a) * k;
};

export default function ChromeMorph() {
  const { active, shots } = useChromeMorph();
  if (!active) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {shots.bar.list && <Bar list={shots.bar.list} note={shots.bar.note} />}
      {shots.dock.list && <Dock list={shots.dock.list} note={shots.dock.note} />}
    </View>
  );
}

function Picture({ shot, left, top, style }: { shot: Shot; left: number; top: number; style?: object }) {
  return (
    <Animated.View style={[{ position: 'absolute', left, top, width: shot.rect.width, height: shot.rect.height }, style]}>
      <Image
        source={{ uri: shot.uri }}
        style={{ width: shot.rect.width, height: shot.rect.height }}
        fadeDuration={0}
        onLoad={() => pictureLoaded(shot.uri)}
      />
    </Animated.View>
  );
}

// The top bar: one capsule, the note's picture under the list's, the list's
// dissolving. Where the two pictures are the same pixels nothing changes.
function Bar({ list, note }: { list: Shot; note?: Shot }) {
  const S = useSoft();
  const r = list.rect;
  const listStyle = useAnimatedStyle(() => ({
    opacity: note ? interpolate(chromeT.value, [0.15, 0.85], [1, 0], Extrapolation.CLAMP) : 1,
  }));
  return (
    <View
      style={{
        position: 'absolute',
        left: r.x,
        top: r.y,
        width: r.width,
        height: r.height,
        borderRadius: r.height / 2,
        backgroundColor: S.chrome,
        boxShadow: S.shadow,
      }}
    >
      {note && <Picture shot={note} left={note.rect.x - r.x} top={note.rect.y - r.y} />}
      <Picture shot={list} left={0} top={0} style={listStyle} />
    </View>
  );
}

// The dock: the list's field flows into the note's capsule, the round
// button slides into the capsule's end and goes; each shape shows its own
// picture, the list's going out in the first half, the note's coming in in
// the second.
function Dock({ list, note }: { list: Shot; note?: Shot }) {
  const S = useSoft();
  const L = list.rect;
  const field = { x: L.x, y: L.y, width: L.width - BUTTON - DOCK_GAP, height: L.height };
  const button = { x: L.x + L.width - BUTTON, y: L.y, width: BUTTON, height: L.height };
  // With no note dock (the keyboard was up, say) the field simply stays.
  const N = note?.rect ?? field;
  const buttonEnd = { x: N.x + N.width - BUTTON, y: N.y, width: BUTTON, height: N.height };

  const fieldShape = useAnimatedStyle(() => {
    const k = chromeT.value;
    return {
      left: lerp(field.x, N.x, k),
      top: lerp(field.y, N.y, k),
      width: lerp(field.width, N.width, k),
      height: lerp(field.height, N.height, k),
    };
  });
  const buttonShape = useAnimatedStyle(() => {
    const k = chromeT.value;
    return {
      left: lerp(button.x, buttonEnd.x, k),
      top: lerp(button.y, buttonEnd.y, k),
      opacity: interpolate(k, [0, 0.6], [1, 0], Extrapolation.CLAMP),
    };
  });
  // The pictures stay where they are on the screen; the shapes move over
  // them - so inside a moving shape a picture is offset by the shape's own
  // movement.
  const listInField = useAnimatedStyle(() => {
    const k = chromeT.value;
    return {
      left: L.x - lerp(field.x, N.x, k),
      top: L.y - lerp(field.y, N.y, k),
      opacity: interpolate(k, [0, 0.45], [1, 0], Extrapolation.CLAMP),
    };
  });
  const noteInField = useAnimatedStyle(() => {
    const k = chromeT.value;
    return {
      left: N.x - lerp(field.x, N.x, k),
      top: N.y - lerp(field.y, N.y, k),
      opacity: interpolate(k, [0.5, 0.95], [0, 1], Extrapolation.CLAMP),
    };
  });
  const listInButton = useAnimatedStyle(() => {
    const k = chromeT.value;
    return {
      left: L.x - lerp(button.x, buttonEnd.x, k),
      top: L.y - lerp(button.y, buttonEnd.y, k),
    };
  });
  const shape = { position: 'absolute' as const, overflow: 'hidden' as const, backgroundColor: S.chrome, boxShadow: S.shadow };
  return (
    <>
      <Animated.View style={[shape, { width: BUTTON, height: L.height, borderRadius: L.height / 2 }, buttonShape]}>
        <Moving shot={list} style={listInButton} />
      </Animated.View>
      <Animated.View style={[shape, { borderRadius: L.height / 2 }, fieldShape]}>
        <Moving shot={list} style={listInField} />
        {note && <Moving shot={note} style={noteInField} />}
      </Animated.View>
    </>
  );
}

function Moving({ shot, style }: { shot: Shot; style: object }) {
  return (
    <Animated.View style={[{ position: 'absolute', width: shot.rect.width, height: shot.rect.height }, style]}>
      <Image
        source={{ uri: shot.uri }}
        style={{ width: shot.rect.width, height: shot.rect.height }}
        fadeDuration={0}
        onLoad={() => pictureLoaded(shot.uri)}
      />
    </Animated.View>
  );
}
