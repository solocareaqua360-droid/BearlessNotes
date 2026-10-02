import { Pressable, Text } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { menuStyles } from './DatabaseChrome';

// Undoing a deletion in one go, in a database's "⋯" (useBin's lastBatch /
// restoreMany): the last deletion whole, or the whole bin - added after
// every photo went to the bin at once and came back one by one (2026-10-02).
export default function BinRestoreRows({
  lastCount,
  allCount,
  onRestoreLast,
  onRestoreAll,
  close,
  ink,
}: {
  lastCount: number;
  allCount: number;
  onRestoreLast: () => void;
  onRestoreAll: () => void;
  close: () => void;
  ink: string;
}) {
  return (
    <>
      {lastCount > 0 && (
        <Pressable
          style={menuStyles.menuRow}
          onPress={() => {
            close();
            onRestoreLast();
          }}
        >
          <Ionicons name="arrow-undo-outline" size={17} color={ink} />
          <Text style={menuStyles.menuRowLabel}>{`Відновити останнє видалення (${lastCount})`}</Text>
        </Pressable>
      )}
      {allCount > lastCount && (
        <Pressable
          style={menuStyles.menuRow}
          onPress={() => {
            close();
            onRestoreAll();
          }}
        >
          <Ionicons name="arrow-undo-outline" size={17} color={ink} />
          <Text style={menuStyles.menuRowLabel}>{`Відновити все з кошика (${allCount})`}</Text>
        </Pressable>
      )}
    </>
  );
}
