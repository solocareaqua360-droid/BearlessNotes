import DocumentScanner, {
  ResponseType,
  ScanDocumentResponseStatus,
} from 'react-native-document-scanner-plugin';

// The scanner, behind a name of this app's own.
//
// Not a wrapper for the sake of one: `react-native-document-scanner-plugin`
// has no browser build at all, and the note editor imported it directly -
// which is what forced the whole editor to be replaced by a stub in the
// web bundle rather than merely doing less there. A local module can have
// a `.web` sibling; a package in node_modules cannot.
//
// Returns the scanned pages, or null when there is nothing to add - the
// user cancelled, or there is no scanner here at all. The caller cannot
// tell those apart and does not need to: both mean "carry on without".
export async function scanPages(): Promise<string[] | null> {
  const result = await DocumentScanner.scanDocument({ responseType: ResponseType.ImageFilePath });
  if (result.status !== ScanDocumentResponseStatus.Success) return null;
  const pages = result.scannedImages;
  return pages?.length ? pages : null;
}

// Whether to offer it at all. False in a browser, where the button would
// be a promise the page cannot keep.
export const canScan = true;
