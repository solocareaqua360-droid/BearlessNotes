// Running inside the Mac app's shell (desktop/main.js loads the page with
// ?desktop=1). A browser tab and the phone answer false.
export function inShell(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.location && new URLSearchParams(window.location.search).get('desktop') === '1';
  } catch {
    return false;
  }
}

// Read once: the address does not change while the page lives.
export const IN_SHELL = inShell();
