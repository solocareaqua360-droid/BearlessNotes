// The file-preview worker, in a browser: nothing.
//
// On the phone this sits invisibly on the Files screen, takes preview
// jobs off a queue one at a time, and renders each file's first page in a
// WebView to make the small picture a row shows. react-native-webview has
// no web build, and the files it would read are on the phone's disk.
//
// Rendering nothing is the correct answer, not a gap: the queue simply
// never drains here, useFilePreview keeps returning nothing, and every
// row falls back to its icon - which is what rows without a preview
// have always shown.
export default function FilePreviewWorker() {
  return null;
}
