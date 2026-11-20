import { queueHeavy, useAmbientHeld, useMotionHeld } from '../utils/motionHold';
import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { claimPatternShot, patternShot, putPatternShot, releasePatternClaim, usePatternShot } from '../utils/patternShots';
import Svg, { G } from 'react-native-svg';
import { lucideElementsOf, renderElement } from './icons/Ionicons';

// THE PATTERN ON A FOLDER'S CARD (2026-10-10): a tiled grid of outline icons
// of what is really inside - a note, a photo, a link... and a folder for each
// subfolder - heavier for what there is more of, in the card's own pattern
// tone (a hair darker than its ground), staggered and slightly tilted. It
// thins out toward the text side so the words are never fought: each icon's
// strength grows with its distance from the card's top-left corner.
//
// ONE Svg for the whole pattern (2026-10-12). It was one icon component per cell - a separate Svg each, ~180 of
// them on a folder's full-width cover, twice while the folder opened (the opening and the cover under it) - and the
// user saw what that cost: «невелика затримка перед відкриттям... анімація виходить різкіша». Now every cell is a
// group of lines in a single drawing, built once per pattern (memoised) and not again on every render.

export type PatternDensity = 'light' | 'normal' | 'dense';
const STEP: Record<PatternDensity, number> = { light: 46, normal: 34, dense: 26 };
const ICON = 18;

// `size`: the box, when the caller knows it - drawn from the FIRST frame then. Measured, the pattern was empty for
// a frame and popped in over a plain colour (the folder's opening, 2026-10-12).
// `shot` (with `size`): drawn as shapes once, then photographed and shown as ONE picture (utils/patternShots) - for
// a folder's cover, which has to grow smoothly.
// `onShown`: the pattern is really on screen - its picture decoded, or its shapes drawn (the folder's opening waits
// for it: a cover shown before its picture had decoded flashed lighter for a few frames).
type Props = { kinds: Record<string, number>; color: string; density: PatternDensity; size?: { w: number; h: number }; shot?: boolean; onShown?: () => void };

function FolderPatternInner({ kinds, color, density, size, shot, onShown }: Props) {
  const [measured, setBox] = useState({ w: 0, h: 0 });
  const box = size ?? measured;
  // The icons in the order they are laid: by weight, repeated by count (at
  // most six repeats of one kind, so a folder of 40 photos still shows a mix).
  const kindsKey = Object.keys(kinds)
    .filter((k) => kinds[k] > 0)
    .sort()
    .map((k) => `${k}:${kinds[k]}`)
    .join('|');
  const sequence = useMemo(() => {
    const names = Object.keys(kinds).filter((k) => kinds[k] > 0).sort((a, b) => kinds[b] - kinds[a]);
    const out: string[] = [];
    const most = Math.max(1, ...names.map((k) => kinds[k]));
    for (let round = 0; round < 6; round += 1) {
      names.forEach((k) => {
        if (Math.ceil((kinds[k] / most) * 6) > round) out.push(k);
      });
    }
    return out.length ? out : names;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey]);
  const step = STEP[density];
  const drawing = useMemo(() => {
    if (box.w <= 0 || sequence.length === 0) return null;
    const cols = Math.ceil(box.w / step) + 1;
    const rows = Math.ceil(box.h / step) + 1;
    const groups: ReactElement[] = [];
    let n = 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = c * step + (r % 2 ? step / 2 : 0);
        const y = r * step;
        // Away from the text corner: 0 at the top-left, 1 at the far corner.
        const away = (x / box.w) * 0.55 + (y / box.h) * 0.75;
        const strength = Math.max(0, Math.min(1, (away - 0.35) / 0.55));
        const name = sequence[n % sequence.length];
        n += 1;
        if (strength <= 0.05) continue;
        const elements = lucideElementsOf(name);
        if (!elements) continue;
        const tilt = (r + c) % 2 ? -12 : 12;
        // An icon is drawn on a 24-unit box; scaled to ICON and turned about its own middle.
        groups.push(
          <G key={`${r}-${c}`} opacity={strength} transform={`translate(${x} ${y}) rotate(${tilt} ${ICON / 2} ${ICON / 2}) scale(${ICON / 24})`}>
            {elements.map((element, i) => renderElement(element, i, color, 'none'))}
          </G>
        );
      }
    }
    return groups;
  }, [box.w, box.h, sequence, step, color]);
  // Not in a browser: the photograph is html2canvas's, painted on an opaque white ground that hid the folder's own
  // colour (a graphite cover came out white with the title lost in the pattern, 2026-10-19). There the shapes stay.
  const shotKey = shot && size && Platform.OS !== 'web' ? patternKeyOf(kinds, size, color, density) : null;
  const picture = usePatternShot(shotKey);
  const holder = useRef<View>(null);
  useEffect(() => {
    if (!shotKey || picture || !drawing || !claimPatternShot(shotKey)) return;
    // A moment after it is drawn (the shapes must have reached the screen to be photographed).
    const timer = setTimeout(() => {
      if (!holder.current) return releasePatternClaim(shotKey);
      const node = holder.current;
      queueHeavy(() => captureRef(node, { format: 'png', result: 'tmpfile' }))
        .then((uri) => putPatternShot(shotKey, uri))
        .catch(() => releasePatternClaim(shotKey));
    }, 350);
    return () => {
      clearTimeout(timer);
      releasePatternClaim(shotKey);
    };
  }, [shotKey, picture, drawing]);
  // Drawn as shapes (no picture yet): on screen once drawn.
  useEffect(() => {
    if (!picture && drawing) onShown?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picture, drawing]);
  if (picture && size) {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image source={{ uri: picture }} style={{ width: size.w, height: size.h }} fadeDuration={0} onLoad={onShown} />
      </View>
    );
  }
  return (
    <View
      ref={holder}
      collapsable={false}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={size ? undefined : (e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {drawing && (
        <Svg width={box.w} height={box.h}>
          {drawing}
        </Svg>
      )}
    </View>
  );
}

export default memo(FolderPatternInner);

// Everything a cover's drawing depends on.
export function patternKeyOf(kinds: Record<string, number>, size: { w: number; h: number }, color: string, density: PatternDensity): string {
  const k = Object.keys(kinds)
    .filter((n) => kinds[n] > 0)
    .sort()
    .map((n) => `${n}:${kinds[n]}`)
    .join('|');
  return `${k}|${Math.round(size.w)}x${Math.round(size.h)}|${color}|${density}`;
}

// A plain look-up of the cache.
function isPatternShotTaken(job: { kinds: Record<string, number>; color: string; density: PatternDensity; size: { w: number; h: number } }): boolean {
  return !!patternShot(patternKeyOf(job.kinds, job.size, job.color, job.density));
}

// THE WARM-UP: the covers of the folders on screen, photographed ahead, off screen and one at a time, so even the
// first opening of a folder grows a picture and not ~800 shapes. Mounted by the explorer in «Модерний».
// `paused`: a folder is opening - the warm-up's ~800 shapes must not land on the opening's frames (it held the
// folder's things back by ~350 ms, 2026-10-12). After a pause, or a new set of folders, it waits again first.
export function PatternWarmup({
  jobs,
  paused,
}: {
  jobs: { key: string; kinds: Record<string, number>; color: string; density: PatternDensity; size: { w: number; h: number } }[];
  paused?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const jobsKey = jobs.map((j) => j.key).join('#');
  // Also held while a motion is playing that must not stall (utils/motionHold: the balloons rising).
  const held = useMotionHeld();
  const ambient = useAmbientHeld();
  useEffect(() => {
    setReady(false);
    if (paused || held || ambient) return;
    // Not while the screen (or the folder just opened) is still coming up.
    const timer = setTimeout(() => setReady(true), 900);
    return () => clearTimeout(timer);
  }, [paused, held, ambient, jobsKey]);
  const [, bump] = useState(0);
  const next = jobs.find((j) => !isPatternShotTaken(j));
  useEffect(() => {
    if (!next) return;
    // One cover at a time, with room between them: each is a short burst of UI thread work.
    const timer = setInterval(() => bump((n) => n + 1), 1200);
    return () => clearInterval(timer);
  }, [next?.key]);
  if (!ready || !next) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: -20000, top: 0, width: next.size.w, height: next.size.h }}>
      <FolderPatternInner key={next.key} kinds={next.kinds} color={next.color} density={next.density} size={next.size} shot />
    </View>
  );
}
