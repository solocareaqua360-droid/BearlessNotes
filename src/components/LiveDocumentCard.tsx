import type { ImageFrame } from '../utils/imageFrame';
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import DocumentCard from './DocumentCard';
import DocumentRefBlockCard from './DocumentRefBlockCard';
import { extractPreview } from '../utils/documentPreview';
import { useSoft } from '../theme/soft';
import type { Block, Tag } from '../types';
import { peekDocument, type DocumentIndex } from '../hooks/useDocumentIndex';

type Props = {
  documentId: string | undefined;
  fallbackTitle?: string;
  index: DocumentIndex;
  tags: Tag[];
  onOpen: (documentId: string) => void;
  // A note just made from chosen blocks: its title is a field to name it in (DocumentCard's editTitle).
  editTitle?: { onDone: (title: string) => void };
};

function faceOf(data: Record<string, unknown>): Face {
  return {
    title: (data.title as string) ?? '',
    updatedAt: (data.updatedAt as number) ?? 0,
    blocks: (data.blocks as Block[]) ?? [],
    tagIds: (data.tagIds as string[]) ?? [],
    coverImageUri: data.coverImageUri as string | undefined,
    coverDriveFileId: data.coverDriveFileId as string | undefined,
    coverFrame: data.coverFrame as ImageFrame | undefined,
    coverGradient: data.coverGradient as string | undefined,
    paperColorEnabled: data.paperColorEnabled as boolean | undefined,
    deletedAt: data.deletedAt as number | undefined,
  };
}

type Face = {
  title: string;
  updatedAt: number;
  blocks: Block[];
  tagIds: string[];
  coverImageUri?: string;
  coverDriveFileId?: string;
  coverFrame?: ImageFrame;
  coverGradient?: string;
  paperColorEnabled?: boolean;
  deletedAt?: number;
};

// ANOTHER NOTE, AS THE DOCUMENTS SCREEN DRAWS IT (the user's, 2026-10-05:
// the card in a note was "старого вигляду", a gradient square where the
// page should be). The same DocumentCard, in its list shape, with the
// page's own miniature - so a note looks the same wherever it is met.
//
// The index carries every note's face but not its blocks, which is what
// the miniature is made of; this card reads its one note live. A note in
// the bin, or gone, falls back to the old card, which already knows how to
// say so.
export default function LiveDocumentCard({ documentId, fallbackTitle, index, tags, onOpen, editTitle }: Props) {
  const soft = useSoft();
  // From the document index's own copy at once (peekDocument): waiting for
  // this card's listener drew the old card for a frame first - the blink
  // the user saw on unfolding «Вкладені».
  const [face, setFace] = useState<Face | null | undefined>(() => {
    const known = documentId ? peekDocument(documentId) : undefined;
    return known ? faceOf(known) : undefined;
  });

  useEffect(() => {
    if (!documentId) return;
    return onSnapshot(
      doc(db, 'documents', documentId),
      (snap) => {
        const data = snap.data();
        if (!data) {
          setFace(null);
          return;
        }
        setFace(faceOf(data));
      },
      // A refused read must not take the note down with it.
      () => setFace(null)
    );
  }, [documentId]);

  // Not known yet: nothing rather than the old card for a moment.
  if (documentId && face === undefined) return null;
  if (!documentId || !face || face.deletedAt) {
    return <DocumentRefBlockCard documentId={documentId} fallbackTitle={fallbackTitle} index={index} onOpen={onOpen} />;
  }

  const preview = extractPreview(face.blocks, face.coverImageUri, undefined, face.coverDriveFileId);
  return (
    <DocumentCard
      id={documentId}
      title={face.title || fallbackTitle || ''}
      updatedAt={face.updatedAt}
      imageUri={preview.imageUri}
      imageDriveFileId={preview.imageDriveFileId}
      imageUris={preview.imageUris}
      imageDriveFileIds={preview.imageDriveFileIds}
      previewText={preview.previewText}
      previewTail={preview.previewTail}
      checklistItems={preview.checklistItems}
      coverGradient={face.coverGradient}
      blocks={face.blocks}
      onPress={() => onOpen(documentId)}
      editTitle={editTitle}
      layout="list"
      // The note's own column already gives it its edges.
      flush
      page={{
        tagIds: face.tagIds,
        tags,
        coverImageUri: face.coverImageUri,
        coverDriveFileId: face.coverDriveFileId,
        coverFrame: face.coverFrame,
        paperColorEnabled: !!face.paperColorEnabled,
      }}
      soft={soft}
    />
  );
}
