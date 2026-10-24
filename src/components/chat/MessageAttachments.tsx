import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { chatColours } from './chatTokens';

export type SentAttachment = { kind: 'photo' | 'file' | 'note' | 'folder'; name: string; sub: string; uri?: string };

const TAGS: Record<string, string> = { PDF: '#C2410C', DOCX: '#2563EB', DOC: '#2563EB', XLSX: '#15803D', XLS: '#15803D', CSV: '#15803D' };

// WHAT WENT WITH A MESSAGE (sketch fin8): right-aligned over the person's bubble - photos as thumbnails, a file as a card with
// its kind's coloured tag, a note or a folder with its own sign.
export default function MessageAttachments({ items, onOpen }: { items: SentAttachment[]; onOpen?: (item: SentAttachment) => void }) {
  const S = useSoft();
  const C = chatColours(S);
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      {items.map((a, i) => {
        if (a.kind === 'photo' && a.uri) {
          return (
            <Pressable key={i} onPress={onOpen ? () => onOpen(a) : undefined}>
              <Image source={{ uri: a.uri }} style={styles.photo} />
            </Pressable>
          );
        }
        const ext = (a.name.split('.').pop() ?? '').toUpperCase();
        const tag = a.kind === 'file' ? TAGS[ext] : undefined;
        return (
          <Pressable key={i} onPress={onOpen ? () => onOpen(a) : undefined} style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow } as never]}>
            <View style={[styles.tile, { backgroundColor: C.wash }]}>
              {tag ? (
                <Text style={[styles.tag, { color: tag }]}>{ext}</Text>
              ) : (
                <Ionicons name={a.kind === 'folder' ? 'folder-outline' : a.kind === 'note' ? 'document-text-outline' : 'document-outline'} size={18} color={S.accent} />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[styles.name, { color: S.ink }]}>
                {a.name}
              </Text>
              <Text numberOfLines={1} style={[styles.sub, { color: S.ink2 }]}>
                {onOpen ? `${a.sub} · відкрити` : a.sub}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, alignSelf: 'flex-end', maxWidth: '92%' },
  photo: { width: 64, height: 64, borderRadius: 14 },
  card: { width: 150, height: 64, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 },
  tile: { width: 36, height: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  tag: { fontSize: 9, fontFamily: SOFT_SEMIBOLD },
  name: { fontSize: 12.5, fontFamily: SOFT_SEMIBOLD },
  sub: { fontSize: 11, fontFamily: SOFT_REGULAR },
});
