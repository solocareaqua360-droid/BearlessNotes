import { G, Path, Text as SvgText } from 'react-native-svg';
import type { SketchElement } from '../types';
import { inkOn, transformOf } from '../utils/sketchGeometry';

// A drawing's elements, inside an <Svg> the caller sizes - one way to draw
// them everywhere a drawing is shown (the note, a sticker, a photo with a
// drawing on it, the editor), so a turned element is turned in all of them.
// `ink` is what the palette's first colour means on this paper.
export default function SketchLayer({ elements, ink }: { elements: SketchElement[]; ink: string }) {
  return (
    <>
      {elements.map((el, i) => {
        const transform = transformOf(el);
        const body =
          el.kind === 'text' ? (
            <SvgText x={el.x} y={el.y} fill={inkOn(el.color, ink)} fontSize={el.fontSize}>
              {el.text}
            </SvgText>
          ) : (
            <Path
              d={el.d}
              stroke={inkOn(el.color, ink)}
              strokeWidth={el.width}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        return (
          <G key={i} transform={transform}>
            {body}
          </G>
        );
      })}
    </>
  );
}
