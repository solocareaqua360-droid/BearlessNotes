import { ReactNode, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import AttachmentImage from './AttachmentImage';
import GeoThumbnail from './GeoThumbnail';
import { Ionicons } from './icons/Ionicons';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { categoryFromSiteName } from '../utils/linkCategory';
import { linkDocId } from '../utils/linkId';
import type { ChatAttachment } from '../utils/chatAttach';

// WHAT A MESSAGE BRINGS WITH IT, drawn as part of the message (the user's
// «варіант А», 2026-10-07): not a card per attachment laid in the message's
// own card, but ONE frame. On top, flush with the bubble's edges, the
// picture - the photo if there is one (the photos first, in a tile when
// there are several), else a video's preview, else the map of a geo point.
// Under it plain rows, a hairline between them: a file, a link, whatever
// has no picture to lead with. The words and the time are the bubble's own.
type LinkRecord = { geoLat?: number; geoLng?: number; title?: string; imageUrl?: string; siteName?: string };

// What the link's own record knows and the message does not: where a geo
// point is. Listened to like the photo's record is.
function useLinkRecord(url: string | null): LinkRecord | null {
  const [record, setRecord] = useState<LinkRecord | null>(null);
  useEffect(() => {
    if (!url) return;
    return onSnapshot(
      doc(db, 'links', linkDocId(url)),
      (snapshot) => setRecord((snapshot.data() as LinkRecord | undefined) ?? null),
      () => setRecord(null)
    );
  }, [url]);
  return record;
}

function PhotoTile({ attachment }: { attachment: Extract<ChatAttachment, { kind: 'photo' }> }) {
  const [driveFileId, setDriveFileId] = useState<string | undefined>();
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'photos', attachment.id),
        (snapshot) => setDriveFileId((snapshot.data() as { driveFileId?: string } | undefined)?.driveFileId),
        () => {}
      ),
    [attachment.id]
  );
  return <AttachmentImage uri={attachment.uri} driveFileId={driveFileId} style={styles.fill} resizeMode="cover" />;
}

function PlayBadge() {
  return (
    <View style={styles.play} pointerEvents="none">
      <Ionicons name="play" size={22} color="#fff" />
    </View>
  );
}

// The lead picture of a message with no photo: a video link's preview, or a
// map for a geo point. A video FILE has no preview this app can make yet: it
// leads with a dark frame and its name.
function Lead({ attachment, ink }: { attachment: ChatAttachment; ink: string }) {
  const record = useLinkRecord(attachment.kind === 'link' ? attachment.url : null);
  if (attachment.kind === 'link') {
    const geo = record?.geoLat != null && record?.geoLng != null;
    if (geo) {
      return <GeoThumbnail lat={record!.geoLat!} lng={record!.geoLng!} width={400} height={250} style={styles.fill} />;
    }
    const image = record?.imageUrl ?? attachment.imageUrl;
    return image ? (
      <>
        <Image source={{ uri: image }} style={styles.fill} resizeMode="cover" resizeMethod="resize" />
        <PlayBadge />
      </>
    ) : null;
  }
  if (attachment.kind === 'file') {
    return (
      <View style={[styles.fill, styles.videoFrame]}>
        <PlayBadge />
        <Text numberOfLines={1} style={[styles.videoName, { color: ink }]}>
          {attachment.name}
        </Text>
      </View>
    );
  }
  return null;
}

function isVideoFile(a: ChatAttachment): boolean {
  return a.kind === 'file' && (a.mimeType ?? '').startsWith('video/');
}
function isGeoOrVideoLink(a: ChatAttachment): 'geo' | 'video' | null {
  if (a.kind !== 'link') return null;
  const c = categoryFromSiteName(a.siteName);
  return c === 'geo' ? 'geo' : c === 'video' ? 'video' : null;
}

function Row({ attachment, onPress, ink, muted, line, bleed, hairline }: { attachment: ChatAttachment; onPress: () => void; ink: string; muted: string; line: string; bleed: number; hairline: boolean }) {
  const record = useLinkRecord(attachment.kind === 'link' ? attachment.url : null);
  let icon: keyof typeof Ionicons.glyphMap = 'link-outline';
  let title = '';
  let sub = '';
  if (attachment.kind === 'file') {
    icon = isVideoFile(attachment) ? 'videocam-outline' : 'document-outline';
    title = attachment.name;
  } else if (attachment.kind === 'link') {
    const kind = isGeoOrVideoLink(attachment);
    icon = kind === 'geo' ? 'location-outline' : kind === 'video' ? 'videocam-outline' : 'link-outline';
    title = record?.title ?? attachment.title ?? attachment.url;
    sub = record?.siteName ?? attachment.siteName ?? '';
  } else {
    icon = 'image-outline';
    title = 'Зображення';
  }
  return (
    <Pressable onPress={onPress} style={[styles.row, { marginHorizontal: -bleed, paddingHorizontal: bleed, borderTopColor: line }, !hairline && { borderTopWidth: 0, paddingTop: 0 }]}>
      <Ionicons name={icon} size={18} color={muted} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: ink }]}>
          {title}
        </Text>
        {!!sub && (
          <Text numberOfLines={1} style={[styles.rowSub, { color: muted }]}>
            {sub}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export default function ChatMessageMedia({
  attachments,
  // The bubble's own padding and corner, so the picture can be flush with it.
  padH,
  padTop,
  radius,
  ink,
  muted,
  line,
  onOpen,
  footer,
}: {
  attachments: ChatAttachment[];
  padH: number;
  padTop: number;
  radius: number;
  ink: string;
  muted: string;
  line: string;
  onOpen: (attachment: ChatAttachment) => void;
  footer?: ReactNode;
}) {
  if (attachments.length === 0) return null;
  const photos = attachments.filter((a): a is Extract<ChatAttachment, { kind: 'photo' }> => a.kind === 'photo');
  // With no photo, the first video (file or link), else the first geo point.
  const lead: ChatAttachment | undefined =
    photos.length > 0
      ? undefined
      : attachments.find((a) => isVideoFile(a) || isGeoOrVideoLink(a) === 'video') ?? attachments.find((a) => isGeoOrVideoLink(a) === 'geo');
  const rest = attachments.filter((a) => a.kind !== 'photo' && a !== lead);

  const shown = photos.slice(0, 4);
  const extra = photos.length - shown.length;
  const top = { marginHorizontal: -padH, marginTop: -padTop, borderTopLeftRadius: radius, borderTopRightRadius: radius, overflow: 'hidden' as const };

  return (
    <View>
      {shown.length > 0 && (
        <View style={top}>
          {shown.length === 1 ? (
            <Pressable onPress={() => onOpen(shown[0])} style={styles.wide}>
              <PhotoTile attachment={shown[0]} />
            </Pressable>
          ) : (
            <View style={styles.grid}>
              {shown.map((p, i) => (
                <Pressable
                  key={`${p.id}-${i}`}
                  onPress={() => onOpen(p)}
                  style={shown.length === 3 && i === 0 ? styles.wide : styles.tile}
                >
                  <PhotoTile attachment={p} />
                  {extra > 0 && i === shown.length - 1 && (
                    <View style={styles.more} pointerEvents="none">
                      <Text style={styles.moreText}>+{extra}</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
      {lead && (
        <Pressable onPress={() => onOpen(lead)} style={[top, styles.wide]}>
          <Lead attachment={lead} ink={ink} />
        </Pressable>
      )}
      {rest.map((a, i) => (
        <Row key={`${a.kind}-${a.id}-${i}`} attachment={a} onPress={() => onOpen(a)} ink={ink} muted={muted} line={line} bleed={padH} hairline={i > 0 || shown.length > 0 || !!lead} />
      ))}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  wide: { width: '100%', aspectRatio: 1.6, backgroundColor: 'rgba(127,127,127,0.12)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  tile: { width: '49.7%', aspectRatio: 1, backgroundColor: 'rgba(127,127,127,0.12)' },
  more: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  moreText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  play: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoFrame: { backgroundColor: '#1f1f23', alignItems: 'center', justifyContent: 'center' },
  videoName: { position: 'absolute', bottom: 10, left: 14, right: 14, fontSize: 13, color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14 },
  rowSub: { fontSize: 12 },
});
