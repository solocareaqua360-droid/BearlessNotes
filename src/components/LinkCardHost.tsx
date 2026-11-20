import { useState } from 'react';
import { Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { arrayUnion, deleteField, doc, updateDoc } from '../firestore';
import { db } from '../firebase';
import LinkDetailSheet, { type DetailLink } from './LinkDetailSheet';
import LinkReaderSheet from './LinkReaderSheet';
import SaveDestinationSheet from './SaveDestinationSheet';
import RenamePrompt from './RenamePrompt';
import { ask, confirm, notify } from './surfaces/Ask';
import { addFragment, deleteArticleForLink, removeFragment, saveArticleForLink, type LinkFragment } from '../utils/articleReader';
import { pickPhotosFromDevice } from '../utils/photoLibrary';
import { mapsUrlForLatLng, type LatLng } from '../utils/geoCoordinates';
import { appendBlocksToToday, blockFromLink, blockFromPhoto, clipBlocksToNote, copyObjectsToNote } from '../utils/copyToNote';
import { generateId } from '../utils/documentBlocks';
import type { FolderItem } from '../hooks/useAllFolderItems';
import type { Block, Tag } from '../types';

// A LINK'S CARD, standing on its own (the single explorer's rule: it must not lean
// on a base's screen - 2026-10-11). The card (comment, photos, the map point,
// the saved page for reading, fragments and their way into a note) with every
// handler it needs, built from the shared utils. The Links base has its own
// copy of these handlers still; when it is touched next, it can take this one.
export default function LinkCardHost({
  item,
  tags,
  onClose,
  onPlayVideo,
  onPickFolders,
  flipFrom,
}: {
  // The link being looked at (null = closed): the record as the explorer reads it.
  item: FolderItem | null;
  tags: Tag[];
  onClose: () => void;
  // A video link plays in the explorer's own player.
  onPlayVideo: (url: string) => void;
  // The thing's folders (the explorer's own window).
  onPickFolders: (item: FolderItem) => void;
  // Opened from its card: the sheet comes round from the card's back (utils/flipOpen).
  flipFrom?: import('../utils/flipOpen').FlipFrom | null;
}) {
  const navigation = useNavigation();
  const [reading, setReading] = useState(false);
  const [fragmentsToSend, setFragmentsToSend] = useState<{ fragments: LinkFragment[] } | null>(null);
  const [naming, setNaming] = useState(false);

  const raw = (item?.raw ?? {}) as Record<string, unknown>;
  const category = item?.linkCategory ?? 'other';
  const link: DetailLink | null = item
    ? {
        id: item.docId,
        url: raw.url as string,
        title: raw.title as string | undefined,
        imageUrl: raw.imageUrl as string | undefined,
        siteName: raw.siteName as string | undefined,
        category,
        createdAt: raw.createdAt as number | undefined,
        updatedAt: raw.updatedAt as number | undefined,
        comment: raw.comment as string | undefined,
        attachments: raw.attachments as Block[] | undefined,
        geoLat: raw.geoLat as number | undefined,
        geoLng: raw.geoLng as number | undefined,
        geoCorrected: raw.geoCorrected as boolean | undefined,
        articleSavedAt: raw.articleSavedAt as number | undefined,
        fragments: raw.fragments as LinkFragment[] | undefined,
      }
    : null;
  const id = item?.docId ?? '';

  async function addPhoto() {
    const answer = await ask({
      title: 'Додати фото',
      actions: [
        { id: 'gallery', label: 'Галерея телефону', icon: 'phone-portrait-outline' },
        { id: 'camera', label: 'Камера', icon: 'camera-outline' },
      ],
    });
    if (answer !== 'gallery' && answer !== 'camera') return;
    const added = await pickPhotosFromDevice(answer);
    if (added.length === 0) return;
    await updateDoc(doc(db, 'links', id), { attachments: arrayUnion(...added.map((p) => blockFromPhoto(p))) });
  }

  // Each fragment as its own italic «quoted» paragraph, then the link it came from.
  function fragmentBlocks(fragments: LinkFragment[]): Block[] {
    const quoted: Block[] = fragments.map((f) => ({
      id: generateId(),
      type: 'paragraph',
      text: `*«${f.text.replace(/\*/g, '∗')}»*`,
    }));
    return [...quoted, blockFromLink({ url: link?.url ?? '', title: link?.title, imageUrl: link?.imageUrl, siteName: link?.siteName })];
  }
  async function sendFragmentsInto(where: 'today' | 'new' | { id: string; title: string }, newTitle?: string) {
    const pending = fragmentsToSend;
    if (!pending || !link) return;
    const blocks = fragmentBlocks(pending.fragments);
    const mirror = [{ collectionName: 'links', id }];
    try {
      let documentId: string;
      if (where === 'today') documentId = await appendBlocksToToday(blocks, mirror);
      else if (where === 'new') {
        documentId = await clipBlocksToNote(newTitle?.trim() || link.title || 'Фрагменти', blocks);
        await updateDoc(doc(db, 'links', id), { [`usedInDocuments.${documentId}`]: true });
      } else documentId = await copyObjectsToNote(where.id, blocks, mirror);
      setFragmentsToSend(null);
      setNaming(false);
      onClose();
      (navigation as unknown as { navigate: (n: string, p: object) => void }).navigate('Editor', { documentId });
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    }
  }

  return (
    <>
      <LinkDetailSheet
        flipFrom={flipFrom}
        link={link}
        folders={item ? tags.filter((t) => item.tagIds.includes(t.id)) : []}
        onPickFolder={() => item && onPickFolders(item)}
        onClose={onClose}
        onOpen={() => {
          if (!link) return;
          if (category === 'video') {
            onClose();
            onPlayVideo(link.url);
            return;
          }
          Linking.openURL(link.url).catch(() => {});
        }}
        onSaveComment={(comment) => {
          const trimmed = comment.trim();
          if (item && trimmed !== (link?.comment ?? '')) updateDoc(doc(db, 'links', id), { comment: trimmed || deleteField() }).catch(() => {});
        }}
        onAddPhoto={() => addPhoto().catch((e) => notify('Фото не додалось', (e as Error).message))}
        onRemovePhoto={(attachmentId) => {
          if (item) updateDoc(doc(db, 'links', id), { attachments: (link?.attachments ?? []).filter((a) => a.id !== attachmentId) }).catch(() => {});
        }}
        onCorrectPosition={(point: LatLng) => {
          if (item) updateDoc(doc(db, 'links', id), { geoLat: point.lat, geoLng: point.lng, geoCorrected: true, url: mapsUrlForLatLng(point) }).catch(() => {});
        }}
        onSaveArticle={async () => {
          if (link) await saveArticleForLink(id, link.url);
        }}
        onRead={() => setReading(true)}
        onDeleteArticle={async () => {
          const yes = await confirm({
            title: 'Прибрати збережену статтю?',
            message: 'Посилання й фрагменти лишаться. Статтю можна зберегти знову.',
            confirmLabel: 'Прибрати',
          });
          if (yes) deleteArticleForLink(id).catch(() => {});
        }}
        onRemoveFragment={(fragment) => {
          if (item) removeFragment(id, fragment).catch(() => {});
        }}
        onFragmentsToNote={(fragments) => setFragmentsToSend({ fragments })}
      />
      <LinkReaderSheet link={reading && link ? { id, url: link.url, title: link.title } : null} onClose={() => setReading(false)} onAddFragment={(text) => addFragment(id, text)} />
      <SaveDestinationSheet
        visible={!!fragmentsToSend && !naming}
        notesOnly
        title={fragmentsToSend && fragmentsToSend.fragments.length > 1 ? `${fragmentsToSend.fragments.length} фрагментів у…` : 'Фрагмент у…'}
        onPickToday={() => sendFragmentsInto('today')}
        onPickNew={() => setNaming(true)}
        onPickExisting={(documentId, documentTitle) => sendFragmentsInto({ id: documentId, title: documentTitle })}
        onClose={() => setFragmentsToSend(null)}
      />
      <RenamePrompt
        visible={naming}
        title="Нова нотатка"
        initialValue={link?.title ?? ''}
        placeholder="Назва нотатки"
        onCancel={() => {
          setNaming(false);
          setFragmentsToSend(null);
        }}
        onSave={(title) => sendFragmentsInto('new', title)}
      />
    </>
  );
}
