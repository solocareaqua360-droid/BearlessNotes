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
