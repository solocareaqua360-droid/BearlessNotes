import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { doc, getDoc, getDocs } from '../firestore';
import { db } from '../firebase';
import { ownedQuery, setDoc } from '../utils/owned';
import {
  BACKUP_SECTIONS,
  FULL_BACKUP,
  LINKS_SHEET,
  TASKS_SHEET,
  backupToDrive,
  type BackupChoice,
  type BackupProgress,
  type BackupResult,
  type BackupSection,
} from '../utils/backup';

// «РЕЗЕРВНА КОПІЯ» in Settings: what goes into a copy (each section, and
// each database inside «Бази» - the user's: "не факт що я захочу
// зберігати всі"), the button that makes one on the Google Drive, how far
// it has got, and what came of it. The choice is kept with the last copy
// (settings/backup), so the weekly offer makes the same copy.
//
// Drawn in Settings' own card styles, handed in, so it reads as one of
// its cards.

type Styles = Record<
  'card' | 'cardHeader' | 'cardTitle' | 'cardBody' | 'cardHint' | 'checkButton' | 'checkLabel' | 'trafficRow' | 'trafficLabel',
  object
>;

const backupDoc = doc(db, 'settings', 'backup');

function lastLabel(ms?: number): string {
  if (!ms) return 'Копій ще не було';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Остання копія: ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// What went wrong, in words - not "java.net.UnknownHostException". And
// not a guess either: the first copy failed to find www.googleapis.com on
// a phone that was plainly online (2026-10-02), and "no internet" was the
// wrong answer. So the app asks the network itself which part fails.
const NETWORK = /UnknownHost|Unable to resolve host|Network request failed|fetch failed|Failed to fetch|timeout/i;

async function reachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.status > 0;
  } catch {
    return false;
  }
}

async function humanError(message: string): Promise<string> {
  if (NETWORK.test(message)) {
    const [google, drive] = await Promise.all([
      reachable('https://www.google.com/generate_204'),
      reachable('https://www.googleapis.com/discovery/v1/apis?name=drive&preferred=true'),
    ]);
    if (google && drive) return `Зв'язок з Диском обірвався, зараз він знову є - спробуй ще раз.\n(${message})`;
    if (google) {
      return `Інтернет у застосунку є, але сервер Диска (www.googleapis.com) не знаходиться - схоже, його блокує приватний DNS, VPN або фільтр реклами.\n(${message})`;
    }
    return `Застосунок не дістається до інтернету, хоча телефон може бути в мережі: перевір дозволені мережеві дані для застосунку, VPN, приватний DNS.\n(${message})`;
  }
  if (/не підключено/i.test(message)) {
    return 'Google Диск не підключено. Підключи його в «Обліковий запис» і спробуй ще раз.';
  }
  return message;
}

export default function BackupCard({ styles, accent, ink }: { styles: Styles; accent: string; ink: string }) {
  const [choice, setChoice] = useState<BackupChoice>(FULL_BACKUP);
  const [lastAt, setLastAt] = useState<number | undefined>();
  const [databases, setDatabases] = useState<{ key: string; label: string }[]>([]);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDoc(backupDoc)
      .then((snap: { data: () => { lastAt?: number; choice?: BackupChoice } | undefined }) => {
        const data = snap.data();
        setLastAt(data?.lastAt);
        if (data?.choice) setChoice({ skipSections: data.choice.skipSections ?? [], skipDatabases: data.choice.skipDatabases ?? [] });
      })
      .catch(() => {});
    getDocs(ownedQuery('customDatabases'))
      .then((snap: { docs: { id: string; data: () => { name?: string } }[] }) =>
        setDatabases([
          { key: TASKS_SHEET, label: 'Справи' },
          { key: LINKS_SHEET, label: 'Посилання' },
          ...snap.docs.map((d) => ({ key: d.id, label: d.data().name || 'База' })),
        ])
      )
      .catch(() => setDatabases([{ key: TASKS_SHEET, label: 'Справи' }, { key: LINKS_SHEET, label: 'Посилання' }]));
  }, []);

  const keep = (next: BackupChoice) => {
    setChoice(next);
    setDoc(backupDoc, { choice: next }, { merge: true }).catch(() => {});
  };
  const toggleSection = (key: BackupSection) =>
    keep({
      ...choice,
      skipSections: choice.skipSections.includes(key)
        ? choice.skipSections.filter((k) => k !== key)
        : [...choice.skipSections, key],
    });
  const toggleDatabase = (key: string) =>
    keep({
      ...choice,
      skipDatabases: choice.skipDatabases.includes(key)
        ? choice.skipDatabases.filter((k) => k !== key)
        : [...choice.skipDatabases, key],
    });

  const run = async () => {
    setError(null);
    setResult(null);
    setProgress({ stage: 'Починаю', done: 0, total: 1 });
    try {
      const done = await backupToDrive(setProgress, choice);
      setResult(done);
      setLastAt(Date.now());
    } catch (e) {
      setError(await humanError((e as Error)?.message ?? String(e)));
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const row = (checked: boolean, label: string, onPress: () => void, inset = false) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={busy}
      style={[styles.trafficRow, { paddingVertical: 6, paddingLeft: inset ? 26 : 0 }]}
    >
      <Ionicons name={checked ? 'checkbox-outline' : 'square-outline'} size={20} color={checked ? accent : '#9CA3AF'} />
      <Text style={[styles.trafficLabel, { color: ink, fontSize: 15 }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name="cloud-upload-outline" size={22} color={accent} />
        <Text style={styles.cardTitle}>Резервна копія на Google Диск</Text>
      </View>
      <Text style={styles.cardHint}>
        Кожна копія - окрема папка в «Bearless Notes / Резервні копії»: нотатки як Google Документи, бази як
        Google Таблиці і архів усіх даних для відновлення. Копії зберігаються місяць, старіші йдуть у кошик Диска. Фото й файли - в одній
        спільній папці для всіх копій: кожне копіюється один раз, далі додаються лише нові.
      </Text>
      <Text style={styles.cardBody}>{lastLabel(lastAt)}</Text>

      <Text style={[styles.cardHint, { marginTop: 8 }]}>Що зберігати</Text>
      {BACKUP_SECTIONS.map((section) => (
        <View key={section.key}>
          {row(!choice.skipSections.includes(section.key), section.label, () => toggleSection(section.key))}
          {section.key === 'databases' &&
            !choice.skipSections.includes('databases') &&
            databases.map((d) => row(!choice.skipDatabases.includes(d.key), d.label, () => toggleDatabase(d.key), true))}
        </View>
      ))}
      <Text style={styles.cardHint}>Архів даних для відновлення зберігається завжди повністю.</Text>

      <Pressable style={styles.checkButton} onPress={run} disabled={busy}>
        {busy ? <ActivityIndicator color={accent} /> : <Text style={styles.checkLabel}>Зробити копію зараз</Text>}
      </Pressable>
      {progress && (
        <Text style={styles.cardHint}>
          {progress.stage}
          {progress.total > 1 ? ` · ${progress.done + 1} з ${progress.total}` : ''} - не закривай застосунок
        </Text>
      )}
      {result && (
        <Text style={styles.cardHint}>
          {`Готово: папка «${result.folderName}». Нотаток ${result.notes}, таблиць ${result.databases}. Фото: ${result.photos} нових, ${result.photosKept} уже були. Файли: ${result.files} нових, ${result.filesKept} уже були.${result.trashed ? ` Старших за місяць копій у кошик: ${result.trashed}.` : ''}`}
          {result.failed.length
            ? `\nНе вдалося ${result.failed.length}:\n${result.failed.slice(0, 6).join('\n')}${result.failed.length > 6 ? '\n…' : ''}`
            : ''}
        </Text>
      )}
      {error && <Text style={[styles.cardHint, { color: '#EF4444' }]}>{error}</Text>}
    </View>
  );
}
