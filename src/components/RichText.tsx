import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import FormattedText from './FormattedText';
import { parseFormattedText } from '../utils/documentBlocks';
import { parseRichLines } from '../utils/richText';
import { FONT_BOLD } from '../utils/fonts';

// A card's text drawn as it was written: numbered and bulleted lists with their markers (and their
// indent), `#` headings, **bold** and the other inline marks. Plain text stays plain lines.
export default function RichText({ text, color, style }: { text: string; color: string; style: TextStyle }) {
  const lines = parseRichLines(text);
  const size = style.fontSize ?? 16;
  return (
    <View>
      {lines.map((line, i) => {
        if (line.kind === 'blank') return <View key={i} style={{ height: Math.round(size * 0.5) }} />;
        const content = (t: string, extra?: TextStyle) => (
          <Text style={[style, { color }, extra]}>
            <FormattedText segments={parseFormattedText(t)} defaultColor={color} />
          </Text>
        );
        if (line.kind === 'heading')
          return (
            <View key={i} style={{ marginTop: i === 0 ? 0 : 4 }}>
              {content(line.text, { fontFamily: FONT_BOLD, fontSize: Math.round(size * (line.level === 1 ? 1.3 : line.level === 2 ? 1.15 : 1.05)) })}
            </View>
          );
        if (line.kind === 'para') return <View key={i}>{content(line.text)}</View>;
        const marker = line.kind === 'number' ? `${line.n}.` : '•';
        return (
          <View key={i} style={[styles.item, { paddingLeft: line.indent * 16 }]}>
            <Text style={[style, { color }, styles.marker, { width: Math.round(size * (line.kind === 'number' ? 1.8 : 1.1)) }]}>{marker}</Text>
            <View style={styles.itemText}>{content(line.text)}</View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  marker: { textAlign: 'left' },
  itemText: { flex: 1 },
});
