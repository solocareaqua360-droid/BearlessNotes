import * as Print from 'expo-print';
import { downloadToFolder } from './downloadToFolder';

// An HTML page out as a PDF file, the phone's way: printed to a file, then
// saved into the folder the user chose for downloads (the same step every
// «Завантажити» takes). The Mac's version is the system's print dialog -
// see htmlToPdf.web.
export async function exportHtmlAsPdf(html: string, fileName: string): Promise<boolean> {
  const { uri } = await Print.printToFileAsync({ html });
  const saved = await downloadToFolder(uri, fileName, 'application/pdf');
  return !!saved;
}
