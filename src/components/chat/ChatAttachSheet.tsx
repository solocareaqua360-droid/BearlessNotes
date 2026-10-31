import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import ChatSheetFrame from '../ChatSheetFrame';
import { useSoft } from '../../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../../utils/fonts';
import { chatColours } from './chatTokens';
import PictureTile from './PictureTile';

// «+» IN THE CHAT (sketch fin5): what can be given to the AI with a message - a picture taken now, pictures from the gallery, a
// file from the phone (PDF, Word, Excel, text), a note of the app, a whole folder. The price of what is picked shows before it
// is sent (the dock's estimate), not here.
export default function ChatAttachSheet({
  visible,
  onClose,
  onCamera,
  onGallery,
  onFile,
  onNote,
  onFolder,
  onLink,
}: {
  visible: boolean;
  onClose: () => void;
  onCamera: () => void;
  onGallery: () => void;
  onFile: () => void;
  onNote: () => void;
  onFolder: () => void;
  // A link of the links base (2026-10-24: «щоб я міг додати посилання з моєї бази»).
  onLink: () => void;
}) {
  const S = useSoft();
  const C = chatColours(S);
  const quick = (label: string, icon: 'camera-outline' | 'images-outline' | 'link-outline', onPress: () => void, dark: boolean) => (
    <Pressable onPress={onPress} accessibilityLabel={label} style={[styles.quick, { backgroundColor: dark ? C.darkBtn : S.card, boxShadow: dark ? undefined : S.shadow } as never]}>
      <Ionicons name={icon} size={22} color={dark ? C.darkBtnInk : S.ink} />
      <Text style={[styles.quickLabel, { color: dark ? C.darkBtnInk : S.ink }]}>{label}</Text>
    </Pressable>
  );
  const tag = (t: string, bg: string) => (
    <Text key={t} style={[styles.tag, { backgroundColor: bg }]}>
      {t}
    </Text>
  );
  const sheet = (rot: number, left: number, top: number) => (
    <View style={[styles.page, { left, top, backgroundColor: S.card, boxShadow: S.shadow, transform: [{ rotate: `${rot}deg` }] } as never]} />
  );
  const filePic = (
    <View style={{ width: 120, height: 56 }}>
      {sheet(-8, 14, 6)}
      {sheet(0, 44, 2)}
      {sheet(8, 74, 6)}
      <View style={styles.tags}>{[tag('PDF', '#C2410C'), tag('DOCX', '#2563EB'), tag('XLSX', '#15803D')]}</View>
    </View>
  );
  const photoPic = (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {['#C9B8A0', '#8FA3A8', '#D9A27A'].map((c) => (
        <View key={c} style={{ width: 26, height: 46, borderRadius: 6, backgroundColor: S.dark ? `${c}99` : c }} />
      ))}
    </View>
  );
  const bar = (w: string, c: string, h = 3) => <View style={{ height: h, width: w as never, borderRadius: 2, backgroundColor: c }} />;
  const notePic = (
    <View style={[styles.note, { backgroundColor: S.dark ? '#141413' : '#FFFDF9', boxShadow: S.shadow } as never]}>
      {bar('70%', S.ink, 5)}
      {bar('95%', C.faint)}
      {bar('85%', C.faint)}
      {bar('60%', C.faint)}
    </View>
  );
  const folderPic = (
    <View style={{ width: 84, height: 54 }}>
      <View style={[styles.folderBack, { backgroundColor: C.wash }]} />
      <View style={[styles.folderTab, { backgroundColor: C.wash }]} />
      <View style={[styles.folderPage, { left: 16, top: 12, backgroundColor: S.dark ? '#141413' : '#FFFDF9' }]} />
      <View style={[styles.folderPage, { left: 30, top: 18, backgroundColor: S.dark ? '#141413' : '#FFFDF9' }]} />
    </View>
  );
  return (
    <ChatSheetFrame visible={visible} onClose={onClose} top={250}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: S.ink }]}>Додати до розмови</Text>
        <Text style={[styles.hint, { color: S.ink2 }]}>ціну видно до відправки</Text>
      </View>
      <View style={styles.quickRow}>
        {quick('Камера', 'camera-outline', onCamera, true)}
        {quick('Галерея', 'images-outline', onGallery, false)}
        {quick('Посилання', 'link-outline', onLink, false)}
      </View>
      <View style={styles.row}>
        <PictureTile picture={filePic} title="Файл з телефона" sub="PDF, Word, Excel, текст" onPress={onFile} />
        <PictureTile picture={photoPic} title="Фото з галереї" sub="кілька одразу" onPress={onGallery} />
      </View>
      <View style={styles.row}>
        <PictureTile picture={notePic} title="Нотатка" sub="з застосунку" onPress={onNote} />
        <PictureTile picture={folderPic} title="Папка" sub="усі нотатки в ній" onPress={onFolder} />
      </View>
    </ChatSheetFrame>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 4 },
  title: { flex: 1, fontSize: 20, fontFamily: SOFT_SEMIBOLD },
  hint: { fontSize: 12, fontFamily: SOFT_MEDIUM },
  quickRow: { flexDirection: 'row', gap: 8 },
  quick: { width: 76, height: 76, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 4 },
  quickLabel: { fontSize: 11.5, fontFamily: SOFT_SEMIBOLD },
  row: { flexDirection: 'row', gap: 10 },
  page: { position: 'absolute', width: 34, height: 44, borderRadius: 6 },
  tags: { position: 'absolute', left: 6, bottom: 2, flexDirection: 'row', gap: 4 },
  tag: { fontSize: 9, fontFamily: SOFT_SEMIBOLD, color: '#FFFFFF', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  note: { width: 70, height: 54, borderRadius: 8, padding: 7, gap: 4 },
  folderBack: { position: 'absolute', left: 8, top: 4, width: 68, height: 44, borderRadius: 10 },
  folderTab: { position: 'absolute', left: 14, top: 0, width: 26, height: 12, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  folderPage: { position: 'absolute', width: 36, height: 26, borderRadius: 5 },
});
