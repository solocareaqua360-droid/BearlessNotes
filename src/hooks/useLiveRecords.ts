import { useEffect, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { Block } from '../types';
import { linkDocId } from '../utils/linkId';
import { refreshLinkPreviewIfExpired } from '../utils/linkPreviewRefresh';
import { listenError } from '../utils/listenError';

// A photo, file or link block showing what its record says NOW.
//
// Every one of those blocks is already a REFERENCE - it carries the id of
// the row in Photos/Files/Links, which is how the app knows the same photo
// appears in three notes. What it also carries is a copy of that row's
// display fields, taken at the moment it was inserted. So renaming a file
// in its database left every note that mentions it showing the old name,
// for ever, with no way to tell that the two had diverged.
//
// A row of a user-created database never had this problem: 'dbRow' renders
// live, by design, and types.ts says so - "unlike every other reference
// block here". This is that sentence being made untrue.
//
// The snapshot stays in the document and stays the fallback. It is what a
// deleted record leaves behind, and what a device with no network shows
// before the listeners answer - a note must never go blank because the
// thing it mentions could not be looked up.

export type LiveRecords = Record<string, Partial<Block>>;

// Which row a block refers to. Photos and files use the record's own id AS
// the block id (see blockFromPhoto/blockFromFile). A link cannot: its
// record is keyed by the URL, canonicalised, so that the same video pasted
// in two forms is one row - see linkDocId.
// Typed by shape rather than by name, so a board CARD fits as readily as a
// document BLOCK: the two differ (a card can be a whole document, a block
// cannot) but both carry an id, a type and a link's url, which is all this
// needs. They are the same reference either way.
type Referencing = { id: string; type?: string; linkUrl?: string };

export function recordIdFor(block: Referencing): string | null {
  const type = block.type ?? 'paragraph';
  if (type === 'image' || type === 'file') return block.id;
  if (type === 'link' && block.linkUrl) return linkDocId(block.linkUrl);
  return null;
}

export function applyLiveRecord<T extends Referencing>(block: T, records: LiveRecords): T {
  const id = recordIdFor(block);
  if (!id) return block;
  const live = records[id];
  if (!live) return block;
  return { ...block, ...live };
}

export function useLiveRecords(enabled: boolean): LiveRecords {
  const [records, setRecords] = useState<LiveRecords>({});

  useEffect(() => {
    if (!enabled) return;
    // Three listeners, and they are cheap here for the same reason every
    // other read in this app is: these are personal collections of dozens
    // of rows, already in the offline cache, and open only while a
    // document that actually references something is on screen.
    const unsubscribes = [
      onSnapshot(ownedQuery('photos'), (snapshot) => {
        setRecords((prev) => {
          const next = { ...prev };
          snapshot.docs.forEach((d) => {
            const data = d.data();
            next[d.id] = {
              imageUri: data.imageUri,
              imageTitle: data.title,
              driveFileId: data.driveFileId,
              driveBytes: data.driveBytes,
            };
          });
          return next;
        });
      }, listenError('useLiveRecords:photos')),
      onSnapshot(ownedQuery('files'), (snapshot) => {
        setRecords((prev) => {
          const next = { ...prev };
          snapshot.docs.forEach((d) => {
            const data = d.data();
            next[d.id] = {
              fileUri: data.fileUri,
              fileName: data.fileName,
              fileTitle: data.title,
              mimeType: data.mimeType,
              driveFileId: data.driveFileId,
              driveBytes: data.driveBytes,
            };
          });
          return next;
        });
      }, listenError('useLiveRecords:files')),
      onSnapshot(ownedQuery('links'), (snapshot) => {
        // A cover past its deadline is fetched again and written to the
        // record; this listener then delivers the live one. Outside the
        // state updater on purpose - React may run an updater twice, and
        // a network call is not something to run twice. See
        // linkPreviewRefresh.
        snapshot.docs.forEach((d) => {
          const data = d.data();
          refreshLinkPreviewIfExpired({ id: d.id, url: data.url, imageUrl: data.imageUrl });
        });
        setRecords((prev) => {
          const next = { ...prev };
          snapshot.docs.forEach((d) => {
            const data = d.data();
            next[d.id] = {
              linkUrl: data.url,
              linkTitle: data.title,
              linkImageUrl: data.imageUrl,
              linkSiteName: data.siteName,
            };
          });
          return next;
        });
      }, listenError('useLiveRecords:links')),
    ];
    return () => unsubscribes.forEach((u) => u());
  }, [enabled]);

  return records;
}
