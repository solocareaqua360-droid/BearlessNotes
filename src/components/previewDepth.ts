import { createContext } from 'react';

// How many page miniatures this is drawn inside (DocumentPageMiniature,
// DayPageMiniature). A card inside a page shows as itself in a miniature,
// as it always did; only a miniature INSIDE a miniature is a still plate -
// two notes that show each other's card used to draw pages inside pages
// without end.
export const PreviewDepthContext = createContext(0);
