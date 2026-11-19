import { auth } from '../firebase';
import { adoptDriveToken, getDriveToken, hasDriveToken } from './driveToken.web';
import { isDesktopShell, requestFromBrowser } from './desktopBridge.web';

// ONE WAY TO CONNECT DRIVE, for every place that finds it missing.
//
// It used to live only in the account strip's bar, which in the Mac shell
// shows up only after a picture has failed to load. Everywhere else a
// missing Drive was a dead end: «Диск не підключений» with a single
// «Зрозуміло» (opening a file from the explorer) or a sentence with no
// button (the file tab). The user's rule (2026-11-19): when something needs
// Drive and Drive is not there, the same place offers to connect it - he
// does not go looking in settings.
//
// Inside the shell Google will not finish a grant in a window the app drew,
// so the browser is asked and the token is carried back (desktopBridge);
// in a browser tab it is the popup, which is allowed because this is
// called from a click.
export async function connectDrive(): Promise<boolean> {
  const email = auth.currentUser?.email ?? null;
  if (isDesktopShell()) {
    const granted = await requestFromBrowser('drive', email).catch(() => null);
    if (granted?.driveToken) adoptDriveToken(granted.driveToken);
  } else {
    await getDriveToken(true, email).catch(() => null);
  }
  return hasDriveToken();
}
