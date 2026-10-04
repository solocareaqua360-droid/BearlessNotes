# The drawing file — `*.sketch.json`

The contract between sketchEva and mindEva. Defined in code in
`src/sketch/format.ts`; this page says the same in words.

```jsonc
{
  "format": "sketchEva",      // always this
  "version": 1,               // SKETCH_VERSION when it was written
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
