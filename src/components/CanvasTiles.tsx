import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { CANVAS_TILE } from './FolderCanvas';
import { fileIconColorFor, fileIconFor } from '../utils/fileIcons';
import { stripFormatting } from '../utils/documentPreview';
import type { Block } from '../types';

// THE FACES of the records on a database's canvas (FolderCanvas) - one
// square tile each, small enough to pour a few dozen on a table and still
// tell them apart: a file by its kind and name, a link by its picture and
// title, a note by its title and first lines.

export function FileCanvasTile({ name }: { name: string }) {
  const S = useSoft();
  return (
    <View style={[styles.face, { backgroundColor: S.card }]}>
      <Ionicons name={fileIconFor(name)} size={30} color={fileIconColorFor(name)} />
      <Text style={[styles.caption, { color: S.ink }]} numberOfLines={2}>
        {name}
      </Text>
    </View>
  );
}

export function LinkCanvasTile({ title, imageUrl, icon }: { title: string; imageUrl?: string; icon: string }) {
  const S = useSoft();
  if (imageUrl) {
    return (
      <View style={[styles.face, styles.picture, { backgroundColor: S.fill }]}>
        <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={[styles.band, { backgroundColor: S.card }]}>
          <Text style={[styles.bandText, { color: S.ink }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.face, { backgroundColor: S.card }]}>
      <Ionicons name={icon as never} size={26} color={S.accent} />
      <Text style={[styles.caption, { color: S.ink }]} numberOfLines={2}>
        {title}
      </Text>
    </View>
  );
}

export function NoteCanvasTile({ title, blocks }: { title: string; blocks?: Block[] }) {
  const S = useSoft();
  const lines = (blocks ?? [])
    .map((b) => stripFormatting(b.text ?? '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('\n');
  return (
    <View style={[styles.face, styles.note, { backgroundColor: S.card }]}>
      <Text style={[styles.noteTitle, { color: S.ink }]} numberOfLines={2}>
        {title || 'Без назви'}
      </Text>
      {!!lines && (
        <Text style={[styles.noteBody, { color: S.ink2 }]} numberOfLines={3}>
          {lines}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    width: CANVAS_TILE,
    height: CANVAS_TILE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 8,
  },
  picture: {
    padding: 0,
    justifyContent: 'flex-end',
  },
  band: {
    alignSelf: 'stretch',
    paddingHorizontal: 6,
    paddingVertical: 3,
    opacity: 0.92,
  },
  bandText: {
    fontSize: 10,
    fontWeight: '600',
  },
  caption: {
    fontSize: 10,
    textAlign: 'center',
  },
  note: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: 3,
  },
  noteTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  noteBody: {
    fontSize: 9,
    lineHeight: 12,
  },
});
