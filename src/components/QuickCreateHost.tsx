import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import { dateKey } from '../utils/dateLocale';
import { useTags } from '../hooks/useTags';
import QuickCreate from './QuickCreate';
import {
  quickAddToDay,
  quickAppendToDocument,
  quickCreateBoard,
  quickCreateCard,
  quickCreateDocument,
  quickCreateLink,
  quickCreateTask,
  quickFileAttachments,
  type Attachment,
  type QuickKind,
} from '../utils/quickCreate';
import type { Tag } from '../types';
import { isTucked } from '../utils/chatOwned';

// THE QUICK-CREATE WINDOW, READY TO DROP ON ANY SCREEN (2026-10-13: the explorer's «+» and the calendar's «+» are the
// same window). It brings its own tags and its own list of notes (read only while the window is open), makes what the
// field says (utils/quickCreate) and tells the screen only what it needs to know: the folder to start in, which type
// is first, a new folder made here to go into, and a line to say once done.
//
// Mounted when first opened and kept: the window's own exit animation needs it standing.
export default function QuickCreateHost({
  visible,
  onClose,
  folder = '',
  initialKind,
  tasksOnDay,
  onEnterFolder,
  onTell,
}: {
  visible: boolean;
  onClose: () => void;
  folder?: string;
  initialKind?: QuickKind;
  tasksOnDay?: boolean;
  onEnterFolder?: (path: string) => void;
  onTell?: (message: string) => void;
}) {
  const [everOpened, setEverOpened] = useState(visible);
  useEffect(() => {
    if (visible) setEverOpened(true);
  }, [visible]);
  if (!everOpened) return null;
  return <Inner visible={visible} onClose={onClose} folder={folder} initialKind={initialKind} tasksOnDay={tasksOnDay} onEnterFolder={onEnterFolder} onTell={onTell} />;
}

function Inner({
  visible,
  onClose,
  folder,
  initialKind,
  tasksOnDay,
  onEnterFolder,
  onTell,
}: {
  visible: boolean;
  onClose: () => void;
  folder: string;
  initialKind?: QuickKind;
  tasksOnDay?: boolean;
  onEnterFolder?: (path: string) => void;
  onTell?: (message: string) => void;
}) {
  const navigation = useNavigation();
  const { tags, attachTag, createFolderTag } = useTags();
  const [documents, setDocuments] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (!visible) return;
    return onSnapshot(
      ownedQuery('documents'),
      (snap) =>
        setDocuments(
          snap.docs
            .filter((d) => !d.id.startsWith('day_') && !isTucked(d.data()))
            .map((d) => ({ id: d.id, title: String((d.data() as { title?: string }).title ?? '') }))
        ),
      listenError('QuickCreateHost:documents')
    );
  }, [visible]);
  const folderPaths = useMemo(() => Array.from(new Set(tags.map((t) => t.path))).sort((a, b) => a.localeCompare(b)), [tags]);
  const live = useRef({ tags, folderPaths });
  live.current = { tags, folderPaths };

  // The tag that stands for a folder path: an existing one, else a new UNIVERSAL one (as the explorer makes it).
  async function tagForPath(path: string): Promise<Tag> {
    const same = live.current.tags.filter((t) => t.path === path).sort((a, b) => b.types.length - a.types.length);
    if (same.length) return same[0];
    const color = '#DAA587';
    const id = await createFolderTag(path, [], color);
    return { id, path, icon: 'folder-outline', color, types: [], usedIn: {}, keep: true };
  }

  async function submit(
    kind: QuickKind | 'files',
    text: string,
    folderPath: string,
    attachments: Attachment[],
    opts: { open: boolean; documentId?: string; dayKey?: string }
  ) {
    const goTo = (name: string, params: object) => (navigation as unknown as { navigate: (n: string, p?: object) => void }).navigate(name, params);
    const here = (verb: string) => (folderPath ? `${verb} в «${folderPath.split('/').pop()}»` : verb);
    const tell = (message: string) => onTell?.(message);
    const attach = attachTag as never;
    if (kind === 'task') {
      await quickCreateTask(text, attachments, tasksOnDay ? opts.dayKey : undefined);
      tell(tasksOnDay && opts.dayKey ? 'Справу додано на день' : 'Справу додано до «Вхідних»');
    } else if (kind === 'day') {
      // What is made OPENS: the note, the day's note, the note written to.
      goTo('Editor', { documentId: await quickAddToDay(text, attachments, opts.dayKey ?? dateKey(new Date())) });
    } else if (kind === 'append' && opts.documentId) {
      await quickAppendToDocument(opts.documentId, text, attachments);
      goTo('Editor', { documentId: opts.documentId });
    } else {
      // Everything else is filed: the folder (made now if it is new) comes first.
      const isNewFolder = !!folderPath && !live.current.folderPaths.includes(folderPath);
      const tag = folderPath ? await tagForPath(folderPath) : null;
      // A folder made right here is WHERE you land: behind a note that opens, going back shows it with the thing in it.
      if (isNewFolder) onEnterFolder?.(folderPath);
      if (kind === 'files') {
        await quickFileAttachments(attachments, tag, attach);
        tell(here('Збережено'));
      } else if (kind === 'document') {
        goTo('Editor', { documentId: await quickCreateDocument(text, tag, attach, attachments), autoFocusTitle: true });
      } else if (kind === 'board') {
        goTo('BoardCopy', { boardId: await quickCreateBoard(text, tag, attach) });
      } else if (kind === 'card') {
        await quickCreateCard(text, tag, attach, attachments);
        tell(here('Картку створено'));
      } else if (kind === 'link') {
        const id = await quickCreateLink(text, tag, attach);
        if (!id) throw new Error('Встав адресу, наприклад https://…');
        tell(here('Посилання збережено'));
      }
    }
  }

  return (
    <QuickCreate
      visible={visible}
      onClose={onClose}
      folder={folder}
      folderPaths={folderPaths}
      documents={documents}
      initialKind={initialKind}
      tasksOnDay={tasksOnDay}
      onSubmit={submit}
    />
  );
}
