// A file's face, by its extension. Shared: file rows are drawn on their
// own screen and inside a group's section on any other one, and the two
// must never disagree about what a PDF looks like.
export function fileIconFor(name: string): 'document-text-outline' | 'document-outline' {
  return name.toLowerCase().endsWith('.pdf') ? 'document-text-outline' : 'document-outline';
}

export function fileIconColorFor(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'pdf') return '#DC2626';
  if (ext === 'doc' || ext === 'docx') return '#2563EB';
  if (ext === 'xls' || ext === 'xlsx') return '#16A34A';
  return '#6B7280';
}
