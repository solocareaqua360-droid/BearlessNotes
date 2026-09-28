import { notify } from '../components/surfaces/Ask';

// Saving a file to a folder of the user's choosing - in a browser, no.
//
// The phone's version copies bytes from the app's own cache into a
// folder the user picked once through Android's document picker, and
// remembers that folder. None of those three things exists here: the
// source is a path on the phone, there is no picker of that kind, and a
// page cannot write to a folder at all.
//
// What a browser has instead is the tab. openFileExternally.web fetches
// the Drive copy and opens it in one, and from there the browser's own
// save does the rest - which is the way every file on the web is saved.
// So these say so rather than throwing into a promise nobody is
// watching, which is what the phone's version did here: the button
// appeared to do nothing.
export async function currentDownloadFolder(): Promise<{ uri: string; label: string } | null> {
  return null;
}

export async function chooseDownloadFolder(): Promise<{ uri: string; label: string } | null> {
  notify('Тека для завантажень', 'У браузері файли зберігаються через саму вкладку: відкрий файл і збережи його там.');
  return null;
}

export async function downloadToFolder(
  _uri: string,
  _fileName: string,
  _mimeType: string
): Promise<{ destUri: string; fileName: string } | null> {
  notify('Зберегти у браузері', 'Відкрий файл - він з\'явиться у новій вкладці, і звідти його можна зберегти.');
  return null;
}

// Showing a file that was just saved. On the phone this fires a VIEW
// intent at the content:// URI the download produced; here there is no
// such URI and no such intent, because nothing was written to a folder
// in the first place - downloadToFolder above says so and returns null.
//
// Kept because PhotosScreen calls it, and a missing export is not a
// no-op: the browser build crashes on the symbol itself.
export async function showDownloadedFile(_uri: string, _mimeType: string): Promise<void> {
  notify('Файл у вкладці', 'У браузері файл відкривається у новій вкладці - звідти його зберігає сам браузер.');
}
