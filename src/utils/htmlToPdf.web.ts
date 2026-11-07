// An HTML page out as a PDF file, the browser's way: the page goes into a
// frame of its own and THAT is printed - on the Mac the system's dialog,
// whose «PDF» button is the save. (expo-print's web version prints the whole
// app page, which is never what was asked.)
export async function exportHtmlAsPdf(html: string, _fileName: string): Promise<boolean> {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
  return true;
}
