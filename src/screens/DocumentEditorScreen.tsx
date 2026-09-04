import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { db } from '../firebase';
import { Block } from '../types';
import { RootStackParamList } from '../navigation';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const AUTOSAVE_DELAY_MS = 600;

function newBlock(): Block {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text: '' };
}

type Props = NativeStackScreenProps<RootStackParamList, 'Editor'>;

export default function DocumentEditorScreen({ route, navigation }: Props) {
  const { documentId } = route.params;
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const focusIdRef = useRef<string | null>(null);
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const snapshot = await getDoc(doc(db, 'documents', documentId));
      const data = snapshot.data();
      setTitle(data?.title ?? '');
      const loadedBlocks: Block[] = data?.blocks ?? [];
      setBlocks(loadedBlocks.length > 0 ? loadedBlocks : [newBlock()]);
      setIsLoaded(true);
    })();
  }, [documentId]);

  useEffect(() => {
    if (!isLoaded) return;
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      updateDoc(doc(db, 'documents', documentId), {
        title,
        blocks,
        updatedAt: Date.now(),
      }).then(() => setSaveStatus('saved'));
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, blocks, isLoaded]);

  useEffect(() => {
    if (focusIdRef.current) {
      inputRefs.current[focusIdRef.current]?.focus();
      focusIdRef.current = null;
    }
  }, [blocks]);

  function handleBlockChange(id: string, text: string) {
    const newlineIndex = text.indexOf('\n');
    if (newlineIndex === -1) {
      setBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, text } : block)));
      return;
    }
    // Enter inserts a literal newline into a multiline TextInput; treat it as
    // "split into a new block" instead of letting the newline stay in the text.
    const before = text.slice(0, newlineIndex);
    const after = text.slice(newlineIndex + 1);
    const created: Block = { ...newBlock(), text: after };
    focusIdRef.current = created.id;
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === id);
      const next = [...prev];
      next[index] = { ...next[index], text: before };
      next.splice(index + 1, 0, created);
      return next;
    });
  }

  function deleteBlock(id: string) {
    setBlocks((prev) => {
      const next = prev.filter((block) => block.id !== id);
      return next.length > 0 ? next : [newBlock()];
    });
  }

  function addBlockAtEnd() {
    const created = newBlock();
    focusIdRef.current = created.id;
    setBlocks((prev) => [...prev, created]);
  }

  function renderBlock({ item, drag, isActive }: RenderItemParams<Block>) {
    return (
      <Swipeable
        overshootRight={false}
        renderRightActions={() => (
          <Pressable style={styles.swipeDelete} onPress={() => deleteBlock(item.id)}>
            <Ionicons name="trash-outline" size={20} color="#fff" />
          </Pressable>
        )}
      >
        <View style={[styles.blockRow, isActive && styles.blockRowActive]}>
          <Pressable onLongPress={drag} hitSlop={8} style={styles.dragHandle}>
            <Ionicons name="reorder-two-outline" size={20} color="#9CA3AF" />
          </Pressable>
          <TextInput
            ref={(ref) => {
              inputRefs.current[item.id] = ref;
            }}
            value={item.text}
            onChangeText={(text) => handleBlockChange(item.id, text)}
            placeholder="Пишіть тут…"
            style={styles.blockInput}
            multiline
          />
        </View>
      </Swipeable>
    );
  }

  if (!isLoaded) {
    return <View style={styles.container} />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <View style={styles.header}>
        <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </Pressable>
        <Text style={styles.headerStatus}>
          {saveStatus === 'saving' ? 'Збереження…' : 'Збережено'}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Без назви"
        style={styles.titleInput}
      />

      <DraggableFlatList
        data={blocks}
        keyExtractor={(item) => item.id}
        renderItem={renderBlock}
        onDragEnd={({ data }) => setBlocks(data)}
        contentContainerStyle={styles.blockList}
      />

      <Pressable style={styles.addBlock} onPress={addBlockAtEnd}>
        <Ionicons name="add" size={18} color={ACCENT} />
        <Text style={styles.addBlockLabel}>Додати блок</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  headerStatus: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  titleInput: {
    fontSize: 24,
    fontWeight: '600',
    color: '#111827',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  blockList: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  blockRowActive: {
    backgroundColor: '#F3F4F6',
  },
  dragHandle: {
    padding: 6,
  },
  blockInput: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  swipeDelete: {
    backgroundColor: DANGER,
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    borderRadius: 10,
    marginVertical: 2,
  },
  addBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  addBlockLabel: {
    fontSize: 15,
    color: ACCENT,
  },
});
