import { createContext, useContext, useEffect, useState } from 'react';
import * as Font from 'expo-font';

// THE NOTE'S OWN FACE (the user, 2026-10-25: picks from the sketch - «Roboto Mono» as the typewriter, «PT Serif» for long
// reading; the handwriting still undecided). Per NOTE, kept on the document (`noteFont`); 'default' is the app's own face
// (utils/appFont). The files ride in the app (assets/fonts, ~70-180 KB each) and are loaded the first time a note asks,
// so a phone that never uses them pays nothing.
export type NoteFont = 'default' | 'mono' | 'serif';
export const NOTE_FONTS: { id: NoteFont; label: string; hint: string }[] = [
  { id: 'default', label: 'Як у застосунку', hint: 'Шрифт з налаштувань' },
  { id: 'mono', label: 'Машинка', hint: 'Roboto Mono - усі літери однієї ширини' },
  { id: 'serif', label: 'Книжковий', hint: 'PT Serif - для довгого читання' },
];
export const asNoteFont = (v: unknown): NoteFont => (v === 'mono' || v === 'serif' ? v : 'default');

type Faces = { regular: string; strong: string };
const FACES: Record<Exclude<NoteFont, 'default'>, Faces> = {
  mono: { regular: 'NoteMono_400', strong: 'NoteMono_700' },
  serif: { regular: 'NoteSerif_400', strong: 'NoteSerif_700' },
};
const FILES: Record<string, number> = {
  NoteMono_400: require('../../assets/fonts/RobotoMono-400.ttf'),
  NoteMono_700: require('../../assets/fonts/RobotoMono-700.ttf'),
  NoteSerif_400: require('../../assets/fonts/PTSerif-Regular.ttf'),
  NoteSerif_700: require('../../assets/fonts/PTSerif-Bold.ttf'),
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
