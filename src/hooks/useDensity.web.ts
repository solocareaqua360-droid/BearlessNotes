import { useEffect, useState } from 'react';

// See useDensity.ts for why this asks about the pointer rather than
// about the window.
//
// `(pointer: fine)` is the browser's own answer to "can whatever is
// pointing at this hit a small target" - true for a mouse or a
// trackpad, false for a finger. It is the same question CSS has been
// asking for a decade, and it needs no guessing about which device this
// is: the Mac application and a laptop browser both answer yes, a
// phone or a Fold answers no, and a laptop with a touchscreen answers
// for whichever is actually in use.
export type Density = 'touch' | 'pointer';

function read(): Density {
  try {
    return window.matchMedia('(pointer: fine)').matches ? 'pointer' : 'touch';
  } catch {
    return 'touch';
  }
}

export function useDensity(): Density {
  const [density, setDensity] = useState<Density>(read);
  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia('(pointer: fine)');
    } catch {
      return;
    }
    const onChange = () => setDensity(read());
    // A mouse plugged into a tablet changes the answer, and so does
    // unplugging it.
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  return density;
}
