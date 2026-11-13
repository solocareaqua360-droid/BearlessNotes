import { useEffect } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocs, updateDoc, where } from '../firestore';
import { bytesOf } from './downloadToFolder.web';
import { isDesktopShell } from './desktopBridge.web';
import { db } from '../firebase';
import { addDoc, ownedQuery } from './owned';
import type { CustomDatabase, CustomDatabaseRow, FieldDef } from '../types';

// THE DEV BOARD BRIDGE (2026-10-30, the user's: «зміни у справах - без ручного імпорту»): Claude, working on this Mac, writes records
// into a file the shell serves (/__desktop/state/dev-board - ~/Library/Application Support/mindEva/state/dev-board.json, written by
// scripts/dev-board.py); the signed-in app reads it every few seconds and puts them into the user's base «розробка» as the user - no key,
// no access of Claude's own to the data. A record is found again by its `key` (kept on the row as `externalId`), else by its title, so
// the same record sent twice is one row, and a later «зроблено» changes the row it made. `delete: true` removes a row only if the
// bridge made it.
const STATE_URL = '/__desktop/state/dev-board';
const BASE_NAME = 'розробка';
const APPLIED_KEY = 'devBoardApplied';
const POLL_MS = 4000;
const PALETTE = ['#DAA587', '#84B799', '#BE7657', '#69736E', '#A0B4AF', '#556E78', '#788782'];

type BoardRecord = {
  key?: string;
  title?: string;
  type?: string;
  status?: string;
  platform?: string;
  date?: string;
  description?: string;
  delete?: boolean;
  at?: number;
};

const id = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function dateKey(value: string): string | null {
  const v = value.trim();
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : null;
}

function readApplied(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(APPLIED_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

let running = false;

async function applyOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const response = await fetch(STATE_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const records = ((await response.json()) as { records?: BoardRecord[] }).records ?? [];
    const applied = readApplied();
    const fresh = records.filter((r) => (r.key || r.title) && applied[r.key || r.title!] !== JSON.stringify(r));
    if (fresh.length === 0) return;

    const databases = await getDocs(ownedQuery('customDatabases'));
    const found = databases.docs.find((d) => String((d.data() as { name?: string }).name ?? '').trim().toLowerCase() === BASE_NAME);
    if (!found) return;
    const database = { id: found.id, ...(found.data() as Omit<CustomDatabase, 'id'>) } as CustomDatabase;
    let fields: FieldDef[] = database.fields ?? [];
    const titleField = fields[0];
    const byName = (name: string) => fields.find((f) => f.name.trim().toLowerCase() === name.toLowerCase());
    const rowsSnapshot = await getDocs(ownedQuery('customDatabaseRows'));
    const rows = rowsSnapshot.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabaseRow, 'id'>) }) as CustomDatabaseRow & { externalId?: string })
      .filter((r) => r.databaseId === database.id);

    // A list value is an option of the field; one the field does not have yet is added to it.
    let fieldsChanged = false;
    const optionId = (field: FieldDef, label: string): string => {
      const options = field.options ?? [];
      const hit = options.find((o) => o.label.trim().toLowerCase() === label.trim().toLowerCase());
      if (hit) return hit.id;
      const made = { id: id(), label: label.trim(), color: PALETTE[options.length % PALETTE.length] };
      field.options = [...options, made];
      fieldsChanged = true;
      return made.id;
    };

    for (const record of fresh) {
      const key = record.key || record.title!;
      const title = (record.title ?? '').trim();
      const row =
        rows.find((r) => r.externalId && r.externalId === record.key) ??
        (title ? rows.find((r) => String(r.values[titleField.id] ?? '').trim().toLowerCase() === title.toLowerCase()) : undefined);

      if (record.delete) {
        if (row?.externalId) await deleteDoc(doc(db, 'customDatabaseRows', row.id));
        applied[key] = JSON.stringify(record);
        continue;
      }
      const values: Record<string, string | number> = {};
      if (title) values[titleField.id] = title;
      const put = (name: string, value: string | undefined) => {
        if (value === undefined || value === '') return;
        const field = byName(name);
        if (!field) return;
        if (field.type === 'select') values[field.id] = optionId(field, value);
        else if (field.type === 'date') {
          const k = dateKey(value);
          if (k) values[field.id] = k;
        } else values[field.id] = value;
      };
      put('Тип', record.type);
      put('Статус', record.status);
      put('Платформа', record.platform);
      put('Дата', record.date);
      put('Опис', record.description);

      const now = Date.now();
      if (row) {
        await updateDoc(doc(db, 'customDatabaseRows', row.id), {
          values: { ...row.values, ...values },
          externalId: record.key ?? row.externalId ?? key,
          updatedAt: now,
        });
        row.values = { ...row.values, ...values };
      } else {
        const ref = await addDoc(collection(db, 'customDatabaseRows'), {
          databaseId: database.id,
          values,
          tagIds: [],
          externalId: key,
          createdAt: now,
          updatedAt: now,
        });
        rows.push({ id: ref.id, databaseId: database.id, values, externalId: key } as CustomDatabaseRow & { externalId?: string });
      }
      applied[key] = JSON.stringify(record);
    }
    if (fieldsChanged) await updateDoc(doc(db, 'customDatabases', database.id), { fields, updatedAt: Date.now() });
    window.localStorage.setItem(APPLIED_KEY, JSON.stringify(applied));
  } catch (e) {
    console.warn('[devBoardBridge]', e);
  } finally {
    running = false;
  }
}

// THE INBOX FOR CLAUDE (2026-11-04, the user: «подивись за сьогодні»): the other direction of the bridge. Every record of the
// base «розробка» that is not closed (вхідне / далі / на паузі) is written, text and screenshots side by side, into
//   ~/Documents/mindEva-порції/розробка-вхідне/   (вхідне.md + <key>-<n>.jpg)
// where a Claude session on this Mac reads it. The folder is emptied and written whole whenever something in it changed, so
// a record that was closed leaves its pictures with it - nothing piles up. Only the signed-in Mac app does this.
const EXPORT_FOLDER = 'розробка-вхідне';
const EXPORT_MS = 60_000;
const EXPORT_SIG_KEY = 'devInboxSignature';
const OPEN_STATUSES = ['вхідне', 'далі', 'на паузі'];
let exporting = false;

async function putFile(file: string, body: Blob | string): Promise<string | null> {
  try {
    const response = await fetch(`/__desktop/export/${encodeURIComponent(EXPORT_FOLDER)}/${encodeURIComponent(file)}`, {
      method: 'PUT',
      headers: { 'X-Mindeva': '1' },
      body,
    });
    return response.ok ? ((await response.json()) as { path?: string }).path ?? null : null;
  } catch {
    return null;
  }
}

const two = (n: number) => String(n).padStart(2, '0');
const dayOf = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
};

async function exportOnce(): Promise<void> {
  if (exporting || !isDesktopShell()) return;
  exporting = true;
  try {
    const databases = await getDocs(ownedQuery('customDatabases'));
    const found = databases.docs.find((d) => String((d.data() as { name?: string }).name ?? '').trim().toLowerCase() === BASE_NAME);
    if (!found) return;
    const database = { id: found.id, ...(found.data() as Omit<CustomDatabase, 'id'>) } as CustomDatabase;
    const fields = database.fields ?? [];
    const by = (name: string) => fields.find((f) => f.name.trim().toLowerCase() === name.toLowerCase());
    const [titleField, typeF, statusF, platformF, descF] = [fields[0], by('Тип'), by('Статус'), by('Платформа'), by('Опис')];
    const shotsF = fields.find((f) => f.type === 'relation' && (!f.relationTarget || f.relationTarget.kind === 'photos') && /скрін/i.test(f.name));
    const label = (f: FieldDef | undefined, v: unknown) => (f?.options?.find((o) => o.id === v)?.label ?? '').trim();

    const snapshot = await getDocs(ownedQuery('customDatabaseRows', where('databaseId', '==', database.id)));
    const rows = snapshot.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabaseRow, 'id'>) }) as CustomDatabaseRow & { createdAt?: number; updatedAt?: number })
      .filter((r) => OPEN_STATUSES.includes(label(statusF, r.values[statusF?.id ?? ''])))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const shotIds = (r: CustomDatabaseRow): string[] => {
      const v = shotsF ? r.values[shotsF.id] : undefined;
      return Array.isArray(v) ? (v as string[]) : typeof v === 'string' && v ? [v] : [];
    };
    const signature = JSON.stringify(rows.map((r) => [r.id, r.updatedAt, shotIds(r)]));
    if (signature === window.localStorage.getItem(EXPORT_SIG_KEY)) return;

    await fetch(`/__desktop/export/${encodeURIComponent(EXPORT_FOLDER)}`, { method: 'DELETE', headers: { 'X-Mindeva': '1' } });

    let unreadable = 0;
    const lines: string[] = [];
    const today = dayOf(Date.now());
    let lastDay = '';
    for (const r of rows) {
      const day = dayOf(r.createdAt ?? 0);
      if (day !== lastDay) {
        lastDay = day;
        lines.push('', `## ${day}${day === today ? ' (сьогодні)' : ''}`, '');
      }
      const title = String(r.values[titleField.id] ?? '').trim() || 'Без назви';
      const meta = [label(typeF, r.values[typeF?.id ?? '']), label(platformF, r.values[platformF?.id ?? '']), label(statusF, r.values[statusF?.id ?? ''])].filter(Boolean).join(' · ');
      lines.push(`- [${meta}] ${title}  (запис ${r.id.slice(-6)})`);
      const description = String(r.values[descF?.id ?? ''] ?? '').trim();
      if (description) lines.push(`    Опис: ${description.replace(/\n/g, '\n    ')}`);
      let n = 0;
      for (const photoId of shotIds(r)) {
        n += 1;
        try {
          const data = (await getDoc(doc(db, 'photos', photoId))).data() as { imageUri?: string; driveFileId?: string } | undefined;
          const blob = data?.imageUri ? await bytesOf(data.imageUri, data.driveFileId) : null;
          const path = blob ? await putFile(`${r.id.slice(-6)}-${n}.jpg`, blob) : null;
          if (path) lines.push(`    Скріншот ${n}: ${path}`);
          else {
            unreadable += 1;
            lines.push(`    Скріншот ${n}: недоступний (на цьому Mac немає його файлу; натисніть «Підключити Диск»)`);
          }
        } catch {
          unreadable += 1;
        }
      }
    }
    const head = [`# Вхідне розробки`, `Оновлено ${today} ${two(new Date().getHours())}:${two(new Date().getMinutes())}. Незакритих записів: ${rows.length}.`];
    const ok = await putFile('вхідне.md', new Blob([[...head, ...lines].join('\n')], { type: 'text/markdown;charset=utf-8' }));
    // A picture that could not be read is tried again later (the signature is not kept), the rest is already there.
    if (ok && unreadable === 0) window.localStorage.setItem(EXPORT_SIG_KEY, signature);
  } catch (e) {
    console.warn('[devBoardBridge] inbox', e);
  } finally {
    exporting = false;
  }
}

export function useDevBoardBridge(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return;
    applyOnce();
    const timer = setInterval(applyOnce, POLL_MS);
    // The inbox a little after start (the first reads settle), then once a minute.
    const first = setTimeout(exportOnce, 8000);
    const slow = setInterval(exportOnce, EXPORT_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
      clearInterval(slow);
    };
  }, [signedIn]);
}
