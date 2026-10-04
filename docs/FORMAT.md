# The drawing file — `*.sketch.json`

The contract between sketchEva and mindEva. Defined in code in
`src/sketch/format.ts`; this page says the same in words.

```jsonc
{
  "format": "sketchEva",      // always this
  "version": 4,               // SKETCH_VERSION when it was written
  "id": "…", "title": "…",
  "createdAt": 0, "updatedAt": 0,
  "width": 0, "height": 0,    // the canvas the elements were drawn against
                              // (= mindEva's sketchWidth / sketchHeight)
  "elements": [ … ],          // SketchElement[] - the same list mindEva keeps
                              // in a note's sketch block (sketchElements)
  "images": { "<uri>": "<base64 jpeg>" },  // export only: pictures inside
  "preview": "<base64 png>"   // export only, NOT WRITTEN YET (see below)
}
```

## Element kinds (version 1)

The three kinds mindEva has: `path` (pen strokes and shapes - a shape keeps
its defining points in `shape`, a closed one may carry `fill`, `noStroke`,
`label`), `text`, `image` (a picture by `uri`, placed and turned like any
element). Turning is `rot` about the element's own box centre. Exact fields:
`src/sketch/format.ts`.

## Version 2: picture crop

An `image` element may carry `crop: {x, y, w, h}` - the part of the WHOLE
picture shown in its box, as fractions 0..1. The picture itself is never cut;
the element's box (`x y w h`) is the window. A reader draws the full picture
sized `w/crop.w` by `h/crop.h`, placed so the crop falls in the box, clipped
to the box. A reader that ignores `crop` shows the picture filling the box
(centred, slightly different) and must save `crop` back untouched.

## Version 3: collage

A new element kind, `collage`: one block holding several pictures in a ready
layout. Fields: `x y w h` (the block's box), `rot?`, `layout` (id: `h2`, `v2`,
`h3`, `v3`, `big2`, `grid4`), `gap` (even space between cells, canvas units),
`cells[]` (one per cell of the layout, in its order; empty cell = `{}`).
A cell: `uri?`, `aspect?` (the picture's width / height), `fx?`/`fy?` (0..1,
the point of the picture kept in the cell's middle, default 0.5) and `zoom?`
(>= 1, default 1). A picture fills its cell ("cover"); layouts are listed in
`src/sketch/collage.ts` (cell rectangles as fractions of the box). A reader
that does not know `collage` keeps the element untouched; the export's
`images` holds every cell's picture by its `uri`.

## Version 4: collage in its own window

A `collage` now also carries `outer?` (clear space between the cells and the
block's edge), `radius?` (corner rounding of every cell), `bg?` (colour behind
the cells and in the gaps; none = see-through) and `splits?` (where the
layout's dividers sit, 0..1 of their space, in the layout's order; none = the
layout's own). Layouts are trees of dividers (see `collage.ts`); the ids
`h2 v2 h3 v3 big2 grid4` of version 3 mean the same layouts, and there are
more (`one h2w v2t big2r big2t big2b h4 big3 big3t g23 g32 g6 g6b`). A reader
that does not know a layout id draws the cells in an equal row.

## Rules for changing it

- Only ADD: a new `kind`, or a new OPTIONAL field on an existing one.
  Never rename, never remove, never change what an existing field means.
- Bump `SKETCH_VERSION` and note the change in `MINDEVA_COMPAT.md`.
- A reader that meets an element it does not know keeps it in the list,
  untouched, and saves it back as it was. Drawing it is optional.
- `preview` (to do): a PNG of the whole drawing, so an app that cannot draw
  some newer element still shows the drawing as it looks. Planned: render
  the SVG off-screen and capture it (react-native-view-shot is already a
  dependency) at export.

## Images

In the app, an image element's `uri` is a file in the app's own folder
(`sketch-images/`). On export each picture is read into `images` under that
uri; on import it is written back out as a new file and the elements are
pointed at it. mindEva's own images also carry a `driveFileId` - optional
here, ignored by sketchEva.
