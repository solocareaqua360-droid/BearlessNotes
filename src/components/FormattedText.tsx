import { Text } from 'react-native';
import type { TextSegment } from '../utils/documentBlocks';

// Pulled out of DocumentEditorScreen.tsx (2026-09-19) - a plain, prop-only
// renderer with no closure over the screen's own state, so the move is
// purely mechanical.
export default function FormattedText({ segments, defaultColor }: { segments: TextSegment[]; defaultColor: string }) {
  return (
    <>
      {segments.map((seg, i) => {
        const decorations = [seg.underline && 'underline', seg.strikethrough && 'line-through']
          .filter(Boolean)
          .join(' ');
        return (
          <Text
            key={i}
            style={{
              fontWeight: seg.bold ? '700' : '400',
              fontStyle: seg.italic ? 'italic' : 'normal',
              textDecorationLine: (decorations || 'none') as 'none' | 'underline' | 'line-through',
              color: seg.color ?? defaultColor,
              backgroundColor: seg.highlight,
            }}
          >
            {seg.text}
          </Text>
        );
      })}
    </>
  );
}
