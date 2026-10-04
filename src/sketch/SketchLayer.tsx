import { G, Image as SvgImage, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { SketchElement, SketchImageElement } from './format';
import { FILL_OPACITY, LABEL_SIZE, inkOn, pivotOf, transformOf } from './sketchGeometry';

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
          el.kind === 'image' ? (
            <SketchPicture el={el} />
          ) : el.kind === 'text' ? (
            <SvgText x={el.x} y={el.y} fill={inkOn(el.color, ink)} fontSize={el.fontSize}>
              {el.text}
            </SvgText>
          ) : (
            <>
              <Path
                d={el.d}
                stroke={el.noStroke ? 'none' : inkOn(el.color, ink)}
                strokeWidth={el.width}
                fill={el.fill ? inkOn(el.fill, ink) : 'none'}
                fillOpacity={FILL_OPACITY}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {!!el.label && (
                <SvgText
                  x={pivotOf(el).x}
                  y={pivotOf(el).y + LABEL_SIZE * 0.35}
                  fill={inkOn(el.color, ink)}
                  fontSize={LABEL_SIZE}
                  textAnchor="middle"
                >
                  {el.label}
                </SvgText>
              )}
            </>
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

// A picture on the drawing. Its copy on this device may be gone (a fresh
// install, a purged cache) - brought back from Drive the way every
// attachment is, with a faint frame where it will be until then.
function SketchPicture({ el }: { el: SketchImageElement }) {
  return (
    <SvgImage
      href={{ uri: el.uri }}
      x={el.x}
      y={el.y}
      width={el.w}
      height={el.h}
      preserveAspectRatio="xMidYMid slice"
    />
  );
}
