import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { addDoc, ownedQuery, setDoc } from '../utils/owned';
import { listenError } from '../utils/listenError';
import { stableStringify } from '../utils/stableStringify';
import { getTabs, replaceTabs, useOpenTabs, type Tab } from './desktopTabs';
import type { Panel, useWorkspace } from './workspace';

// SAVED WORKSPACES («Шаблони»), the laptop's only. A template is the window
// as it was arranged: the tabs of the main pane (and which one was in
// front), the side panels - what each holds and where a click inside it had
// taken it, their column, folded or not, their share of the height - the
// two columns' widths, and whether the side area was put away. Kept in the
// cloud (the user's choice), so another computer has them too.
//
// A template changes only when it is SAVED: working in it (opening and
// closing panels, dragging a splitter) leaves the template as it was, and
// the next time it is chosen it comes back as saved. While the window
// differs from the saved one, the template's row carries a dot and offers
// «Зберегти зміни» - the way an editor marks an unsaved document.
export type WorkspaceTemplate = {
  id: string;
  name: string;
  tabs: Tab[];
  activeKey: string | null;
  panels: Panel[];
  widths: [number, number];
  hidden: boolean;
  updatedAt: number;
};

type Workspace = NonNullable<ReturnType<typeof useWorkspace>>;

const COLLECTION = 'workspaceTemplates';
const ACTIVE_KEY = 'mindeva.activeTemplate';

// Firestore refuses a field whose value is undefined - a panel's optional
// fields often are - so what is stored has been through JSON first.
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// What "the same arrangement" means for the dot: the tab row, the panels,
// the widths and the hidden flag - not which tab happens to be in front,
// which changes with every click and is only remembered for coming back.
function shape(t: { tabs: Tab[]; panels: Panel[]; widths: [number, number]; hidden: boolean }): string {
  return stableStringify({
    tabs: t.tabs.map((x) => x.key),
    panels: t.panels.map((p) => ({
      kind: p.kind,
      target: p.target ?? null,
      column: p.column,
      folded: !!p.folded,
      weight: Math.round((p.weight ?? 1) * 100) / 100,
      stack: p.stack ?? [],
    })),
    widths: t.widths.map((w) => Math.round(w)),
    hidden: t.hidden,
  });
}

// ---- which template the window stands in ------------------------------------

let activeId: string | null = (() => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_KEY) : null;
  } catch {
    return null;
  }
})();
const activeListeners = new Set<() => void>();

function setActive(id: string | null) {
  activeId = id;
  try {
    if (typeof localStorage !== 'undefined') {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    }
  } catch {
    // Forgotten after a restart, then - the templates themselves are kept.
  }
  activeListeners.forEach((l) => l());
}

export function useActiveTemplateId(): string | null {
  const [value, setValue] = useState(activeId);
  useEffect(() => {
    const listener = () => setValue(activeId);
    activeListeners.add(listener);
    listener();
    return () => {
      activeListeners.delete(listener);
    };
  }, []);
  return value;
}

// ---- the list ------------------------------------------------------------------

export function useWorkspaceTemplates(): WorkspaceTemplate[] {
  const [list, setList] = useState<WorkspaceTemplate[]>([]);
  useEffect(
    () =>
      onSnapshot(
        ownedQuery(COLLECTION),
        (snapshot) =>
          setList(
            snapshot.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<WorkspaceTemplate, 'id'>) }))
              .sort((a, b) => a.name.localeCompare(b.name))
          ),
        listenError('workspaceTemplates')
      ),
    []
  );
  return list;
}

// Whether the window differs from the template it stands in.
export function useTemplateDirty(template: WorkspaceTemplate | undefined, workspace: Workspace | null): boolean {
  const tabs = useOpenTabs();
  return useMemo(() => {
    if (!template || !workspace) return false;
    const now = shape({
      tabs: tabs.filter((t) => t.kind !== 'start'),
      panels: workspace.panels,
      widths: workspace.widths,
      hidden: workspace.hidden,
    });
    return now !== shape(template);
  }, [template, workspace, tabs]);
}

// ---- saving and putting back ---------------------------------------------------

function current(workspace: Workspace, activeKey: string | null) {
  return plain({
    tabs: getTabs(),
    activeKey,
    panels: workspace.panels,
    widths: workspace.widths,
    hidden: workspace.hidden,
    updatedAt: Date.now(),
  });
}

export async function saveAsTemplate(name: string, workspace: Workspace, activeKey: string | null) {
  const ref = await addDoc(collection(db, COLLECTION), { name, ...current(workspace, activeKey) });
  setActive(ref.id);
}

export async function updateTemplate(id: string, workspace: Workspace, activeKey: string | null) {
  await setDoc(doc(db, COLLECTION, id), current(workspace, activeKey), { merge: true });
  setActive(id);
}

export async function renameTemplate(id: string, name: string) {
  await setDoc(doc(db, COLLECTION, id), { name }, { merge: true });
}

export async function deleteTemplate(id: string) {
  if (activeId === id) setActive(null);
  await deleteDoc(doc(db, COLLECTION, id));
}

// The window becomes the template: its tabs, its panels, its widths. Going
// to the tab that was in front is the caller's (it knows how to navigate).
export function applyTemplate(template: WorkspaceTemplate, workspace: Workspace) {
  replaceTabs(template.tabs ?? []);
  workspace.replaceAll({
    panels: template.panels ?? [],
    widths: template.widths ?? [380, 380],
    hidden: !!template.hidden,
  });
  setActive(template.id);
}
