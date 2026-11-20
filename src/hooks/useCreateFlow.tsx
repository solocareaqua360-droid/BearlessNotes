import { useMemo, useState, type ReactNode } from 'react';
import { ask, notify } from '../components/surfaces/Ask';
import RenamePrompt from '../components/RenamePrompt';
import FlashcardEditor from '../components/FlashcardEditor';
import GeoPointEntrySheet from '../components/GeoPointEntrySheet';
import { addFilesInPlace, addPhotosInPlace, createItem, saveLinkInPlace, type CreateKind } from '../utils/createItem';
import { fetchLinkPreview, type LinkPreview } from '../utils/linkPreview';
import { mapsUrlForLatLng } from '../utils/geoCoordinates';
import type { useTags } from './useTags';
import type { Group, Tag } from '../types';

// THE «+» FAN'S MAKING, for any screen that has a folder to put things in
// (the explorer; the projects window has its own older copy in
// ProjectFolders, which does the same - see the remaining plan, B).
// `start(kind, folder)` runs the whole flow for one kind: a name asked for a
// document or a board, the card editor for a card, an address for a link, the
// gallery for a photo, the picker for a file - and each is saved INTO the
// folder (when there is one) and its own database. Whatever it needs to show
// comes back in `nodes`, to be rendered once anywhere in the screen.
export type StartKind = CreateKind | 'folder' | 'project';

export function useCreateFlow({
  navigation,
  tagApi,
  groups,
  groupId,
  onCreated,
  attach,
  cardFolder,
}: {
  navigation: unknown;
  tagApi: Pick<ReturnType<typeof useTags>, 'tags' | 'attachTag' | 'detachTag' | 'createAndAttachTag' | 'renameTag'>;
  groups: Group[];
  groupId?: string;
  // Called with the record's id once it is made (the explorer then opens it).
  onCreated?: (id: string) => void;
  // How a new record is filed under the folder - the Projects screen files it under the folder's tag OF ITS KIND
  // (ProjectFolders' attachForKind); by default the folder's own (universal) tag.
  attach?: (tag: Tag, kind: string, itemId: string, collection: string) => Promise<void>;
  // The tag a new card goes under (the Projects screen: the folder's «flashcard» tag). Default: the folder itself.
  cardFolder?: (folder: Tag) => Promise<Tag | null>;
}): { start: (kind: StartKind, folder: Tag | null) => Promise<void>; nodes: ReactNode } {
  const attachTag = attach ?? (tagApi.attachTag as (tag: Tag, kind: string, itemId: string, collection: string) => Promise<void>);
  const [linkFlow, setLinkFlow] = useState<{ folder: Tag | null; step: 'url' | 'title' | 'coords'; busy?: boolean; url?: string; preview?: LinkPreview } | null>(null);
  const [makeFlow, setMakeFlow] = useState<{ kind: 'document' | 'board'; folder: Tag | null } | null>(null);
  const [cardFlow, setCardFlow] = useState<{ folder: Tag | null } | null>(null);
  const cardDefaultTags = useMemo(() => (cardFlow?.folder ? [cardFlow.folder.id] : undefined), [cardFlow?.folder?.id]);

  async function saveLink(url: string, preview: LinkPreview, title: string, folder: Tag | null) {
    try {
      onCreated?.(await saveLinkInPlace(url, preview, title, { folder, groupId, attachTag }));
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    }
  }

  async function start(key: StartKind, folder: Tag | null) {
    if (key === 'document' || key === 'board') {
      setMakeFlow({ kind: key, folder });
      return;
    }
    if (key === 'card') {
      setCardFlow({ folder: folder && cardFolder ? await cardFolder(folder) : folder });
      return;
    }
    if (key === 'photo') {
      const source = await ask({
        title: 'Додати фото',
        actions: [
          { id: 'gallery', label: 'Галерея телефону', icon: 'phone-portrait-outline' },
          { id: 'camera', label: 'Камера', icon: 'camera-outline' },
        ],
      });
      if (source !== 'gallery' && source !== 'camera') return;
      try {
        const ids = await addPhotosInPlace(source, { folder, groupId, attachTag });
        if (ids.length > 0) onCreated?.(ids[0]);
      } catch (e) {
        notify('Не збереглося', (e as Error).message);
      }
      return;
    }
    if (key === 'file') {
      try {
        const ids = await addFilesInPlace({ folder, groupId, attachTag });
        if (ids.length > 0) onCreated?.(ids[0]);
      } catch (e) {
        notify('Не збереглося', (e as Error).message);
      }
      return;
    }
    if (key === 'link' || key === 'video') {
      setLinkFlow({ folder, step: 'url' });
      return;
    }
    if (key === 'geo') {
      const choice = await ask({
        title: 'Нова геоточка',
        actions: [
          { id: 'url', label: 'Вставити посилання' },
          { id: 'coords', label: 'Ввести координати' },
        ],
      });
      if (choice === 'url') setLinkFlow({ folder, step: 'url' });
      else if (choice === 'coords') setLinkFlow({ folder, step: 'coords' });
      return;
    }
    if (key === 'folder' || key === 'project') return; // the screen's own
    await createItem(key, { folder, groupId, navigation, attachTag });
  }

  const nodes = (
    <>
      <RenamePrompt
        visible={makeFlow !== null}
        title={makeFlow?.kind === 'board' ? 'Нова дошка' : 'Новий документ'}
        placeholder="Без назви"
        initialValue=""
        allowEmpty
        onCancel={() => setMakeFlow(null)}
        onSave={async (name) => {
          const flow = makeFlow;
          setMakeFlow(null);
          if (!flow) return;
          try {
            const id = await createItem(flow.kind, { folder: flow.folder, groupId, navigation, attachTag, stay: true, title: name });
            if (id) onCreated?.(id);
          } catch (e) {
            notify('Не збереглося', (e as Error).message);
          }
        }}
      />
      <FlashcardEditor
        visible={cardFlow !== null}
        card={null}
        groups={groups}
        defaultGroupId={groupId}
        defaultTagIds={cardDefaultTags}
        tagApi={tagApi}
        onSaved={(id) => onCreated?.(id)}
        onClose={() => setCardFlow(null)}
      />
      <RenamePrompt
        visible={linkFlow?.step === 'url'}
        title="Нове посилання"
        placeholder="https://…"
        initialValue=""
        busy={!!linkFlow?.busy}
        onCancel={() => setLinkFlow(null)}
        onSave={async (raw) => {
          const flow = linkFlow;
          const url = raw.trim();
          if (!flow || !url) return;
          setLinkFlow({ ...flow, busy: true });
          const preview = await fetchLinkPreview(url);
          if (preview.title) {
            setLinkFlow(null);
            await saveLink(url, preview, preview.title, flow.folder);
          } else {
            // Nothing to name it by (a bare Maps link, a page without a title): ask.
            setLinkFlow({ folder: flow.folder, step: 'title', url, preview });
          }
        }}
      />
      <RenamePrompt
        visible={linkFlow?.step === 'title'}
        title="Назва посилання"
        initialValue=""
        onCancel={() => setLinkFlow(null)}
        onSave={async (title) => {
          const flow = linkFlow;
          setLinkFlow(null);
          if (flow?.url && flow.preview && title.trim()) await saveLink(flow.url, flow.preview, title.trim(), flow.folder);
        }}
      />
      <GeoPointEntrySheet
        visible={linkFlow?.step === 'coords'}
        onCancel={() => setLinkFlow(null)}
        onSave={async ({ title, point }) => {
          const flow = linkFlow;
          setLinkFlow(null);
          if (flow) await saveLink(mapsUrlForLatLng(point), { siteName: 'Геоточка', geoLat: point.lat, geoLng: point.lng }, title, flow.folder);
        }}
      />
    </>
  );
  return { start, nodes };
}
