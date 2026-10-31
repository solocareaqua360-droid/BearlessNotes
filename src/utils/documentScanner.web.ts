// No scanner in a browser: the one this app uses is Android's own ML Kit
// document scanner, which is a native screen, not a camera API this page
// could stand in for.
//
// `canScan` is false, so the editor leaves the button out rather than
// showing one that explains itself only after being pressed. scanPages
// still exists, and still answers null, because a UI is allowed to be
// wrong about which platform it is on - it must not crash when it is.
export async function scanPages(): Promise<string[] | null> {
  return null;
}

export const canScan = false;
