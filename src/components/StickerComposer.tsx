import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { doc, setDoc, updateDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { SketchElement } from '../types';
import { backupFileToDrive } from '../utils/googleDrive';
import SketchEditor from './SketchEditor';

const STICKER_TEXT_LIMIT = 140;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Same resize-then-compress every other image-picking flow in this app
// already goes through (DocumentEditorScreen's image blocks, PhotosScreen's
// own "+") - duplicated rather than shared, per this app's established
// convention for small single-purpose helpers.
async function compressPickedImage(uri: string, width: number, height: number): Promise<string> {
  const MAX_DIMENSION = 1600;
  try {
    const longest = Math.max(width, height);
    let context = ImageManipulator.manipulate(uri);
    if (longest > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / longest;
      context = context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    return uri;
  }
}

type Props = {
  visible: boolean;
  onClose: () => void;
  // When set, edits this existing TEXT sticker's text instead of creating a
  // new sticker - photo/sketch stickers are viewed/re-edited directly by
  // the calling screen (ZoomableImageViewer / SketchEditor), not through
  // here, since there's nothing left for a "choose type" step to do once
  // the type is already fixed.
  editingTextSticker?: { id: string; text: string } | null;
};

// Creates a new sticker (text/photo/sketch - a "choose type" sheet, then
// whichever flow applies) or edits an existing text sticker's text. The
// caller is responsible for the 10-free-stickers cap check BEFORE ever
// setting `visible` - this component has no opinion on how many stickers
// already exist.
export default function StickerComposer({ visible, onClose, editingTextSticker }: Props) {
  const [step, setStep] = useState<'choose' | 'text'>(editingTextSticker ? 'text' : 'choose');
  const [text, setText] = useState(editingTextSticker?.text ?? '');
  const [sketchVisible, setSketchVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep(editingTextSticker ? 'text' : 'choose');
    setText(editingTextSticker?.text ?? '');
  }, [visible, editingTextSticker]);

  async function choosePhoto(source: 'gallery' | 'camera') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const imageUri = await compressPickedImage(asset.uri, asset.width, asset.height);
    const id = generateId();
    const now = Date.now();
    await setDoc(doc(db, 'stickers', id), {
      type: 'image',
      imageUri,
      usedInDocuments: {},
      createdAt: now,
      updatedAt: now,
    });
    // Registers in the Зображення database too, per the explicit
    // requirement that a sticker's photo "lands in the photo database" -
    // a one-time write sharing the sticker's own id, not an ongoing
    // two-way sync (renaming/deleting one side later doesn't touch the
    // other).
    await setDoc(doc(db, 'photos', id), {
      imageUri,
      usedInDocuments: {},
      createdAt: now,
      updatedAt: now,
    });
    backupFileToDrive(imageUri, `${id}.jpg`, 'image/jpeg', 'Photos').then((uploaded) => {
      if (!uploaded) return;
      updateDoc(doc(db, 'stickers', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
      updateDoc(doc(db, 'photos', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
    });
    onClose();
  }

  function saveSketch(elements: SketchElement[], width: number, height: number) {
    const id = generateId();
    const now = Date.now();
    setDoc(doc(db, 'stickers', id), {
      type: 'sketch',
      sketchElements: elements,
      sketchWidth: width,
      sketchHeight: height,
      usedInDocuments: {},
      createdAt: now,
      updatedAt: now,
    });
    setSketchVisible(false);
    onClose();
  }

  function saveText() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (editingTextSticker) {
      updateDoc(doc(db, 'stickers', editingTextSticker.id), { text: trimmed, updatedAt: Date.now() });
    } else {
      const id = generateId();
      const now = Date.now();
      setDoc(doc(db, 'stickers', id), {
        type: 'paragraph',
        text: trimmed,
        usedInDocuments: {},
        createdAt: now,
        updatedAt: now,
      });
    }
    onClose();
  }

  return (
    <>
      <Modal visible={visible && step === 'choose'} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>Новий стікер</Text>
            <Pressable style={styles.row} onPress={() => setStep('text')}>
              <Ionicons name="reader-outline" size={18} color="#111827" />
              <Text style={styles.rowLabel}>Текст</Text>
            </Pressable>
            <Pressable style={styles.row} onPress={() => choosePhoto('gallery')}>
              <Ionicons name="image-outline" size={18} color="#111827" />
              <Text style={styles.rowLabel}>Фото з галереї</Text>
            </Pressable>
            <Pressable style={styles.row} onPress={() => choosePhoto('camera')}>
              <Ionicons name="camera-outline" size={18} color="#111827" />
              <Text style={styles.rowLabel}>Фото з камери</Text>
            </Pressable>
            <Pressable style={styles.row} onPress={() => setSketchVisible(true)}>
              <Ionicons name="brush-outline" size={18} color="#111827" />
              <Text style={styles.rowLabel}>Малюнок</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={visible && step === 'text'} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.textBackdrop}>
          <View style={styles.textCard}>
            <Text style={styles.title}>{editingTextSticker ? 'Редагувати стікер' : 'Текстовий стікер'}</Text>
            <TextInput
              autoFocus
              multiline
              maxLength={STICKER_TEXT_LIMIT}
              value={text}
              onChangeText={setText}
              placeholder="Коротка думка…"
              style={styles.textInput}
            />
            <Text style={styles.counter}>
              {text.length} / {STICKER_TEXT_LIMIT}
            </Text>
            <View style={styles.textButtons}>
              <Pressable style={styles.cancelButton} onPress={onClose}>
                <Text style={styles.cancelLabel}>Скасувати</Text>
              </Pressable>
              <Pressable
                style={[styles.saveButton, !text.trim() && styles.saveButtonDisabled]}
                disabled={!text.trim()}
                onPress={saveText}
              >
                <Text style={styles.saveLabel}>Зберегти</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <SketchEditor
        visible={sketchVisible}
        initialElements={[]}
        onSave={saveSketch}
        onClose={() => {
          setSketchVisible(false);
          onClose();
        }}
      />
    </>
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
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  rowLabel: {
    fontSize: 15,
    color: '#111827',
  },
  textBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  textCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  textInput: {
    minHeight: 100,
    fontSize: 15,
    color: '#111827',
    textAlignVertical: 'top',
  },
  counter: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'right',
  },
  textButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  cancelLabel: {
    fontSize: 15,
    color: '#6B7280',
  },
  saveButton: {
    backgroundColor: '#8a7a1f',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
