import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Asset } from 'expo-asset';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { Ionicons } from '../components/icons/Ionicons';
import { useAttachmentSource } from '../hooks/useAttachmentSource';
import { openFileExternally } from '../utils/openFileExternally';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';

// A FILE IN A TAB (the laptop's): opened with «Відкрити в новій вкладці» on
// a file, stepped through with the tab's arrows like a note (see
// DesktopTabs' TabStepper).
//
// What it can show, and with what:
//   PDF        - Chromium's own viewer (zoom, search, print), in a frame;
//   Word .docx - mammoth, to HTML;
//   Excel      - SheetJS, to tables;
//   pictures   - as they are;
//   plain text - as it is.
// mammoth and SheetJS are the very files the phone's quick look carries
// (assets/quicklook) - nothing new is installed and nothing is fetched
// from the internet. Anything else says so and offers the program that
// opens it.
//
// The bytes come the way a picture's do (useAttachmentSource): the Mac's
// kept copy first, Drive after.

type FileDoc = { fileUri: string; fileName: string; title?: string; mimeType?: string; driveFileId?: string };
type Kind = 'pdf' | 'docx' | 'xlsx' | 'image' | 'text' | 'other';

const MAMMOTH = require('../../assets/quicklook/mammoth.jslib');
const XLSX_LIB = require('../../assets/quicklook/xlsx.jslib');

function kindOf(name: string): Kind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'xlsx';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['txt', 'md', 'json', 'log', 'xml', 'yaml', 'yml'].includes(ext)) return 'text';
  return 'other';
}

// A library from the phone's quick look, into this page once. Read as text
// and run inline: the file is served under its own extension, which a
// browser need not agree to run as a script.
const loaded = new Map<number, Promise<void>>();
function loadLibrary(module: number): Promise<void> {
  const running = loaded.get(module);
  if (running) return running;
  const job = (async () => {
    const response = await fetch(Asset.fromModule(module).uri);
    const code = await response.text();
    const script = document.createElement('script');
    script.textContent = code;
    document.head.appendChild(script);
  })();
  loaded.set(module, job);
  job.catch(() => loaded.delete(module));
  return job;
}

// The converted page, in a frame of its own with scripts off: its styles
// cannot reach the app's, and nothing in a document can run.
function pageFor(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0 auto; max-width: 820px; padding: 32px 40px 80px; font: 15px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f1e1c; background: #fff; }
  img { max-width: 100%; height: auto; }
  h1, h2, h3 { line-height: 1.25; }
  h2.sheet { font-size: 13px; color: #6b6a66; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: .05em; }
  table { border-collapse: collapse; font-size: 13px; margin: 8px 0 16px; }
  td, th { border: 1px solid #e3e1dc; padding: 4px 8px; vertical-align: top; }
  .muted { color: #9a9892; }
</style></head><body>${body}</body></html>`;
}

async function convert(kind: 'docx' | 'xlsx', source: string): Promise<string> {
  const bytes = await (await fetch(source)).arrayBuffer();
  const w = window as unknown as {
    mammoth?: { convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };
    XLSX?: {
      read: (data: Uint8Array, opts: { type: 'array' }) => { SheetNames: string[]; Sheets: Record<string, Record<string, unknown>> };
      utils: { sheet_to_html: (sheet: unknown, opts: { header: string; footer: string }) => string };
    };
  };
  if (kind === 'docx') {
    await loadLibrary(MAMMOTH);
    const result = await w.mammoth!.convertToHtml({ arrayBuffer: bytes });
    return result.value || '<p class="muted">Порожній документ</p>';
  }
  await loadLibrary(XLSX_LIB);
  const book = w.XLSX!.read(new Uint8Array(bytes), { type: 'array' });
  const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
  let html = '';
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    html += `<h2 class="sheet">${escape(name)}</h2>`;
    // An empty sheet has no range, and the library reads one unguarded -
    // see the phone's quick look.
    if (!sheet || !sheet['!ref']) {
      html += '<p class="muted">Порожній аркуш</p>';
      continue;
    }
    try {
      html += w.XLSX!.utils.sheet_to_html(sheet, { header: '', footer: '' });
    } catch {
      html += '<p class="muted">Цей аркуш показати не вдалося</p>';
    }
  }
  return html || '<p class="muted">Порожня таблиця</p>';
}

export default function FileViewScreen() {
  const S = useSoft();
  const route = useRoute();
  const fileId = (route.params as { fileId?: string } | undefined)?.fileId ?? '';
  const [file, setFile] = useState<FileDoc | null | undefined>(undefined);

  useEffect(() => {
    setFile(undefined);
    if (!fileId) return;
    return onSnapshot(
      doc(db, 'files', fileId),
      (snapshot) => setFile(snapshot.exists() ? (snapshot.data() as FileDoc) : null),
      () => setFile(null)
    );
  }, [fileId]);

  const { status, source } = useAttachmentSource(file?.fileUri, file?.driveFileId, false);
  const kind = file ? kindOf(file.fileName || '') : 'other';

  // What the frame shows: a PDF as itself, a document or a table converted.
  const [frame, setFrame] = useState<{ src?: string; srcDoc?: string; error?: string } | null>(null);
  useEffect(() => {
    setFrame(null);
    if (!source || status !== 'ready') return;
    let cancelled = false;
    let made: string | null = null;
    (async () => {
      try {
        if (kind === 'pdf') {
          // Typed on purpose: a kept copy may have been stored without its
          // type, and Chromium shows a PDF only when told it is one.
          const blob = await (await fetch(source)).blob();
          made = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
          if (!cancelled) setFrame({ src: made });
        } else if (kind === 'docx' || kind === 'xlsx') {
          const html = await convert(kind, source);
          if (!cancelled) setFrame({ srcDoc: pageFor(html) });
        } else if (kind === 'text') {
          const text = await (await fetch(source)).text();
          const escaped = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
          if (!cancelled) setFrame({ srcDoc: pageFor(`<pre style="white-space:pre-wrap;font:13px/1.55 ui-monospace,Menlo,monospace">${escaped}</pre>`) });
        }
      } catch (e) {
        if (!cancelled) setFrame({ error: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [source, status, kind]);

  const name = file ? file.title || file.fileName : '';
  const openElsewhere = () => {
    if (file) openFileExternally(file);
  };

  let body: ReactNode;
  if (file === null) {
    body = <Message S={S} icon="alert-circle-outline" text="Цього файлу більше немає" />;
  } else if (file === undefined || status === 'checking' || status === 'restoring') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={S.ink3} />
      </View>
    );
  } else if (status !== 'ready' || !source) {
    body = (
      <Message
        S={S}
        icon="cloud-offline-outline"
        text="Файлу немає ні на цьому Mac, ні на Диску - або Диск не підключений."
      />
    );
  } else if (kind === 'image') {
    body = <img src={source} alt={name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
  } else if (kind === 'other') {
    body = (
      <Message S={S} icon="document-outline" text="Цей файл тут не показати." action={{ label: 'Відкрити в програмі', onPress: openElsewhere }} />
    );
  } else if (frame?.error) {
    body = (
      <Message S={S} icon="alert-circle-outline" text={`Не вдалося показати файл: ${frame.error}`} action={{ label: 'Відкрити в програмі', onPress: openElsewhere }} />
    );
  } else if (!frame) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={S.ink3} />
      </View>
    );
  } else {
    body = (
      <iframe
        key={frame.src ?? 'doc'}
        title={name}
        src={frame.src}
        srcDoc={frame.srcDoc}
        // A converted document runs nothing; a PDF is Chromium's own viewer.
        sandbox={frame.srcDoc ? '' : undefined}
        style={{ border: 0, width: '100%', height: '100%', background: '#fff' }}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: S.bg }]}>
      <View style={[styles.bar, { borderBottomColor: S.line }]}>
        <Ionicons name="document-outline" size={16} color={S.ink2} />
        <Text style={[styles.title, { color: S.ink }]} numberOfLines={1}>
          {name}
        </Text>
        {!!file && (
          <Pressable
            onPress={openElsewhere}
            style={(state) => [styles.barButton, (state as { hovered?: boolean }).hovered && { backgroundColor: S.fill }]}
          >
            <Ionicons name="open-outline" size={15} color={S.ink2} />
            <Text style={[styles.barButtonLabel, { color: S.ink2 }]}>Відкрити в програмі</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.body}>{body}</View>
    </View>
  );
}

function Message({
  S,
  icon,
  text,
  action,
}: {
  S: ReturnType<typeof useSoft>;
  icon: string;
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.center}>
      <Ionicons name={icon as never} size={34} color={S.ink3} />
      <Text style={[styles.message, { color: S.ink2 }]}>{text}</Text>
      {action && (
        <Pressable onPress={action.onPress} style={[styles.action, { backgroundColor: S.ink }]}>
          <Text style={[styles.actionLabel, { color: S.bg }]}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  barButton: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 8 },
  barButtonLabel: { fontSize: 13, fontFamily: SOFT_MEDIUM },
  body: { flex: 1, minHeight: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  message: { fontSize: 14, fontFamily: SOFT_MEDIUM, textAlign: 'center', maxWidth: 420 },
  action: { height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  actionLabel: { fontSize: 13.5, fontFamily: SOFT_SEMIBOLD },
});
