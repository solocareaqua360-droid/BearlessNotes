# What mindEva can follow — the ledger

Every feature of sketchEva, and whether it can go back into mindEva. Kept
up to date with every feature discussed or built; the user is told the
verdict BEFORE a feature is built.

Verdicts: **так** - the same in mindEva, by moving code over (OTA);
**спрощено** - a lighter version there (say what); **ні** - stays here only
(say why, and how mindEva still keeps such an element intact).

| Feature | Format change | mindEva | Notes |
|---|---|---|---|
| Everything mindEva's editor had on 2026-10-04 (pen, line, arrow, rectangle, ellipse, text, labels in shapes, fill, select/move/resize/rotate, marquee, partial eraser, big canvas with pan/zoom, guides, pictures) | none (v1) | так | The starting point - it IS mindEva's editor. |
| Drawings as files, export/import of `*.sketch.json` | file shape `SketchFile` | так (import) | mindEva needs: «Імпорт малюнка» → a new sketch block from the file's elements + width/height; pictures into its attachments. Not built yet. |
| In-app update button («Оновити»: check, download, restart; expo-updates) | none | ні (not needed) | App-only, lives in `src/updates.ts` outside `src/sketch/`; mindEva already ships over the air its own way. |
| Drawings screen after mindEva's «Зображення» desk: nested folders (explorer, path in the bar, new / rename branch / move / delete-lifts-up), grid (2 cols, 3 from 640) or list, sort with direction, search in the dock, hold menu over the lifted card (move, rename, export, duplicate, to bin), drag onto a folder with undo toast, bin (30 days, restore, clear, undo last) | none (app-only `library.json` v2: folder paths, assign, trash, sort, view) | ні | App-only; mindEva already has this screen. Left out by the user: projects, a drawing in several folders, vibration (needs an APK). |
| Picture crop (hold a picture; frame with free / 1:1 / 4:3 / 3:4 / 16:9 / 9:16; re-croppable any time, picture never cut) | v2: optional `crop` on `image` | так | One optional field, a clip in `SketchLayer` (`SketchPicture`) and `CropOverlay.tsx`. Until mindEva has the clip, a cropped picture shows there filling its box and keeps `crop` on the round trip. |
| Collage block («Склейка», like Samsung Photo Collage): pick up to 6 photos, then its own window - layouts (tree of draggable dividers that settle onto each other), picture moved/pinched inside its cell, gap / border / corner rounding, background colour, proportions; hold a collage on the canvas to reopen it | v3 new element kind `collage`; v4 `outer`, `radius`, `bg`, `splits` | ні | Stays here for now: mindEva cannot draw the kind yet. It survives a round trip there untouched (pictures travel in `images`). To port: `collage.ts`, `SketchCollage` in `SketchLayer.tsx`, and (for editing) `CollageEditor.tsx`. |

## How the code goes back

`src/sketch/` here is mindEva's `src/components/SketchEditor.tsx`,
`SketchLayer.tsx` and `src/utils/sketchGeometry.ts`, with these cuts made
for the split (undo them when moving code back):

- pictures: no Google Drive backup (`backupFileToDrive`), no «Із
  «Зображень»» picker (`AddExistingItemModal`); a picked picture is copied
  to `documentDirectory/sketch-images/` instead of the cache;
- `SketchLayer` draws a picture straight from its uri (mindEva restores it
  from Drive first via `useCachedAttachment`);
- theme, fonts, icons: local copies (`theme.ts`, `fonts.ts`, `icons/`)
  instead of mindEva's `theme/soft`, `ThemeProvider`, `utils/fonts`,
  `components/icons`.
