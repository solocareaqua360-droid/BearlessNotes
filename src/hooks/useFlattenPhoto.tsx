import { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { SketchElement } from '../types';
import { ensureLocalFile } from '../utils/googleDrive';

// Puts a photograph and its drawing together into ONE file, for the one
// moment that needs it: sharing or downloading. The two are never
// merged on disk otherwise - the drawing is a layer beside the picture
// precisely so "show the original" can be a switch (see SketchEditor's
// background canvas) - but a shared JPEG has no layers to switch
// between, so it has to leave as one flat picture or leave without the
// drawing at all.
//
// A React ref is the only way react-native-view-shot can photograph
// anything, so this is a hook: call `flatten()` from an event handler,
// and keep `node` mounted somewhere in the tree (off-screen while idle,
// for one frame when a flatten is actually asked for).
type FlattenRequest = {
  uri: string;
  elements: SketchElement[];
  width: number;
  height: number;
  resolve: (uri: string) => void;
};

export function useFlattenPhoto() {
  const [request, setRequest] = useState<FlattenRequest | null>(null);

  async function flatten(
    uri: string,
    driveFileId: string | undefined,
    elements: SketchElement[] | undefined,
    width: number | undefined,
    height: number | undefined
  ): Promise<string> {
    // Nothing to flatten - the common case - is the original file,
    // untouched, exactly as sharing has always worked.
    if (!elements?.length || !width || !height) return uri;
    // The photo has to actually be ON the device to be photographed
    // together with its drawing - the same pull-back-from-Drive every
    // other flow already does before touching a local file.
    const here = await ensureLocalFile(uri, driveFileId);
    if (!here) return uri;
    return new Promise((resolve) => {
      setRequest({ uri, elements, width, height, resolve });
    });
  }

  const node = request ? (
    <View style={{ position: 'absolute', top: -100000, left: -100000 }} pointerEvents="none">
      <FlattenStage
        {...request}
        onDone={(result) => {
          request.resolve(result);
          setRequest(null);
        }}
      />
    </View>
  ) : null;

  return { flatten, node };
}

function FlattenStage({
  uri,
  elements,
  width,
  height,
  onDone,
}: {
  uri: string;
  elements: SketchElement[];
  width: number;
  height: number;
  onDone: (uri: string) => void;
}) {
  const stageRef = useRef<View>(null);

  return (
    <View
      ref={stageRef}
      collapsable={false}
      style={{ width, height }}
      // A tick for the image AND the svg to actually paint before the
      // shot is taken - onLayout fires once this view has its size, not
      // once its children have finished drawing into it.
      onLayout={() => {
        setTimeout(async () => {
          try {
            const shot = await captureRef(stageRef, { format: 'jpg', quality: 0.92, result: 'tmpfile' });
            onDone(shot);
          } catch {
            // Better a shared photo with no drawing than a share that
            // silently does nothing.
            onDone(uri);
          }
        }, 80);
      }}
    >
      <Image source={{ uri }} style={{ width, height, position: 'absolute' }} resizeMode="cover" />
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute' }}>
        {elements.map((el, i) =>
          el.kind === 'text' ? (
            <SvgText key={i} x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize}>
              {el.text}
            </SvgText>
          ) : (
            <Path
              key={i}
              d={el.d}
              stroke={el.color}
              strokeWidth={el.width}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        )}
      </Svg>
    </View>
  );
}
