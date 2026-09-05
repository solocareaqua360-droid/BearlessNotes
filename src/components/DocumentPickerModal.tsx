import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const ACCENT = '#3B82F6';

export type PickableDocument = { id: string; title: string };

type Props = {
  visible: boolean;
  subtitle?: string;
  documents: PickableDocument[];
  onPick: (documentId: string) => void;
  onClose: () => void;
};

// Shown when an object (link/photo/file) is used in more than one document -
// its "go to document" icon opens this instead of navigating straight there.
export default function DocumentPickerModal({ visible, subtitle, documents, onPick, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Де вставлено</Text>
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
          {documents.map((d) => (
            <Pressable key={d.id} style={styles.row} onPress={() => onPick(d.id)}>
              <View style={styles.docIcon}>
                <Ionicons name="document-text-outline" size={16} color={ACCENT} />
              </View>
              <Text style={styles.rowText} numberOfLines={1}>
                {d.title}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 2,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  docIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    fontSize: 16,
    color: '#111827',
    flex: 1,
  },
});
