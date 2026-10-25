import { createContext, useContext, useEffect, useState } from 'react';
import * as Font from 'expo-font';

// THE NOTE'S OWN FACE (the user, 2026-10-25: picks from the sketch - «Roboto Mono» as the typewriter, «PT Serif» for long
// reading; the handwriting still undecided). Per NOTE, kept on the document (`noteFont`); 'default' is the app's own face
// (utils/appFont). The files ride in the app (assets/fonts, ~70-180 KB each) and are loaded the first time a note asks,
// so a phone that never uses them pays nothing.
export type NoteFont = 'default' | 'mono' | 'serif' | 'hand';
export const NOTE_FONTS: { id: NoteFont; label: string; hint: string }[] = [
  { id: 'default', label: 'Як у застосунку', hint: 'Шрифт з налаштувань' },
  { id: 'mono', label: 'Машинка', hint: 'Roboto Mono - усі літери однієї ширини' },
  { id: 'serif', label: 'Книжковий', hint: 'PT Serif - для довгого читання' },
  { id: 'hand', label: 'Рукописний', hint: 'Caveat, «д» з хвостиком, літери трохи гуляють по висоті' },
];
// The app's own face in a note (M PLUS Rounded: 0.52 x-height, a little smaller than Inter) is set this much larger than the
// page's base sizes (the user, 2026-10-25: «дрібним ... всім, які шрифти, можна так»). The «Розмір шрифту» slider multiplies on top.
export const DEFAULT_NOTE_SCALE = 1.08;
export const asNoteFont = (v: unknown): NoteFont => (v === 'mono' || v === 'serif' || v === 'hand' ? v : 'default');

// `scale`: a face's lowercase is smaller than the app's (Caveat's x-height is 0.40 against 0.52): its text is set this much
// larger so the page does not read tiny (the user, 2026-10-25: «аномально дрібним»).
type Faces = { regular: string; strong: string; scale: number };
const FACES: Record<Exclude<NoteFont, 'default'>, Faces> = {
  mono: { regular: 'NoteMono_400', strong: 'NoteMono_700', scale: 1.08 },
  serif: { regular: 'NoteSerif_400', strong: 'NoteSerif_700', scale: 1.12 },
  hand: { regular: 'NoteHand_400', strong: 'NoteHand_700', scale: 1.5 },
};
const FILES: Record<string, number> = {
  NoteMono_400: require('../../assets/fonts/RobotoMono-400.ttf'),
  NoteMono_700: require('../../assets/fonts/RobotoMono-700.ttf'),
  NoteSerif_400: require('../../assets/fonts/PTSerif-Regular.ttf'),
  NoteSerif_700: require('../../assets/fonts/PTSerif-Bold.ttf'),
  // Caveat made by hand (OFL, renamed «MindEva Hand»): «д» with a tail, and a `calt` cycle of four slightly different heights.
  NoteHand_400: require('../../assets/fonts/Hand-400.ttf'),
  NoteHand_700: require('../../assets/fonts/Hand-700.ttf'),
};

let loading: Promise<void> | null = null;
let loaded = false;
function ensureLoaded(): Promise<void> {
  if (!loading) {
    loading = Font.loadAsync(FILES)
      .then(() => {
        loaded = true;
      })
      .catch(() => {
        loading = null;
      });
  }
  return loading;
}

// The font the notes below draw in; BlockRow / PagePreviewRow read it, an editor or a miniature provides it.
export const NoteFontContext = createContext<NoteFont>('default');

// The family names to draw in, or null for the app's own face (and while the files are still loading).
export function useNoteFaceFor(font: NoteFont): Faces | null {
  const [, ready] = useState(loaded);
  useEffect(() => {
    if (font === 'default' || loaded) return;
    let live = true;
    ensureLoaded().then(() => live && ready(true));
    return () => {
      live = false;
    };
  }, [font]);
  return font !== 'default' && loaded ? FACES[font] : null;
}
export function useNoteFace(): Faces | null {
  return useNoteFaceFor(useContext(NoteFontContext));
}
