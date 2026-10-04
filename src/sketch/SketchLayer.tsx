import { useId } from 'react';
import { ClipPath, Defs, G, Image as SvgImage, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { SketchCollageElement, SketchElement, SketchImageElement } from './format';
import { cellRects, placement } from './collage';
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
          ) : el.kind === 'collage' ? (
            <SketchCollage el={el} />
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
  const clipId = `crop${useId().replace(/[^a-zA-Z0-9]/g, '_')}`;
  const c = el.crop;
  if (!c) {
    return (
      <SvgImage href={{ uri: el.uri }} x={el.x} y={el.y} width={el.w} height={el.h} preserveAspectRatio="xMidYMid slice" />
    );
  }
  // Cropped: the WHOLE picture is laid out so that the cropped part falls
  // exactly in the box, and the box clips the rest away. Nothing is cut
  // from the file - widening the crop brings it back.
  const fullW = el.w / c.w;
  const fullH = el.h / c.h;
  return (
    <>
      <Defs>
        <ClipPath id={clipId}>
          <Rect x={el.x} y={el.y} width={el.w} height={el.h} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${clipId})`}>
        <SvgImage
          href={{ uri: el.uri }}
          x={el.x - c.x * fullW}
          y={el.y - c.y * fullH}
          width={fullW}
          height={fullH}
          preserveAspectRatio="none"
        />
      </G>
    </>
  );
}

// A collage: a background, then every cell clips its picture to its own
// (rounded) rectangle; an empty cell is a faint tile, so the layout reads.
function SketchCollage({ el }: { el: SketchCollageElement }) {
  const base = `col${useId().replace(/[^a-zA-Z0-9]/g, '_')}`;
  const rects = cellRects(el);
  const rx = (r: { w: number; h: number }) => Math.max(0, Math.min(el.radius ?? 0, r.w / 2, r.h / 2));
  return (
    <>
      <Defs>
        {rects.map((r, i) => (
          <ClipPath key={i} id={`${base}_${i}`}>
            <Rect x={r.x} y={r.y} width={r.w} height={r.h} rx={rx(r)} ry={rx(r)} />
          </ClipPath>
        ))}
      </Defs>
      {!!el.bg && <Rect x={el.x} y={el.y} width={el.w} height={el.h} fill={el.bg} />}
      {rects.map((r, i) => {
        const cell = el.cells[i];
        if (!cell?.uri) {
          return <Rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={rx(r)} ry={rx(r)} fill="rgba(128,128,128,0.16)" />;
        }
        const p = placement(cell, r);
        return (
          <G key={i} clipPath={`url(#${base}_${i})`}>
            <SvgImage href={{ uri: cell.uri }} x={p.x} y={p.y} width={p.w} height={p.h} preserveAspectRatio="none" />
          </G>
        );
      })}
    </>
  );
}
