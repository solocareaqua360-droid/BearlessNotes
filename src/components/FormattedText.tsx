import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { LINK_GLYPH, type TextSegment } from '../utils/documentBlocks';
import { parseTimecode, TIMECODE_PATTERN } from '../utils/videoEmbed';

// A segment's text cut around its timecodes ("04:32") - each one a run of
// its own, carrying the second it points at.
function splitByTimecode(text: string): { text: string; seconds?: number }[] {
  const out: { text: string; seconds?: number }[] = [];
  let from = 0;
  for (const m of text.matchAll(TIMECODE_PATTERN)) {
    const seconds = parseTimecode(m[0]);
    if (seconds === null || m.index === undefined) continue;
    if (m.index > from) out.push({ text: text.slice(from, m.index) });
    out.push({ text: m[0], seconds });
    from = m.index + m[0].length;
  }
  if (from < text.length) out.push({ text: text.slice(from) });
  return out;
}

// The yellow search results have always used (DocumentCard's own
// `highlight`), so a match looks the same on a card's line and on a page.
export const SEARCH_HIGHLIGHT = '#FEF08A';
const SEARCH_INK = '#111827';
// The match the search stands on now (the arrows step through them, «3 з 7»): the same mark, stronger.
export const SEARCH_CURRENT = '#FB923C';

// How many matches FormattedText marks in a text - counted the way it marks them (segment by segment; a note link and a
// timecode run are not marked), so a counter built from this agrees with what is on the page.
export function searchMatchCount(segments: TextSegment[], query: string, withTimecodes = false): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let n = 0;
  for (const seg of segments) {
    if (seg.noteLink) continue;
    if (withTimecodes && TIMECODE_PATTERN.test(seg.text)) {
      TIMECODE_PATTERN.lastIndex = 0;
      continue;
    }
    TIMECODE_PATTERN.lastIndex = 0;
    n += splitByQuery(seg.text, q).filter((r) => r.match).length;
  }
  return n;
}

// A segment's text cut into plain and matching runs, case-insensitively.
// A match that straddles two differently formatted segments is found in
// neither - rare, and cheaper than re-flowing formatting around it.
function splitByQuery(text: string, query: string): { text: string; match: boolean }[] {
  const lower = text.toLowerCase();
  const out: { text: string; match: boolean }[] = [];
  let from = 0;
  let at = lower.indexOf(query, from);
  while (at !== -1) {
    if (at > from) out.push({ text: text.slice(from, at), match: false });
    out.push({ text: text.slice(at, at + query.length), match: true });
    from = at + query.length;
    at = lower.indexOf(query, from);
  }
  if (from < text.length) out.push({ text: text.slice(from), match: false });
  return out;
}

// Plain text with no formatting of its own (a title) and a search query
// marked in it - drawn inside the caller's own Text, so it keeps that
// Text's font, size and weight.
export function SearchMarked({ text, search }: { text: string; search?: string }) {
  const query = search?.trim().toLowerCase() ?? '';
  if (!query || !text.toLowerCase().includes(query)) return <>{text}</>;
  return (
    <>
      {splitByQuery(text, query).map((run, i) =>
        run.match ? (
          <Text key={i} style={{ backgroundColor: SEARCH_HIGHLIGHT, color: SEARCH_INK }}>
            {run.text}
          </Text>
        ) : (
          run.text
        )
      )}
    </>
  );
}

// Pulled out of DocumentEditorScreen.tsx (2026-09-19) - a plain, prop-only
// renderer with no closure over the screen's own state, so the move is
// purely mechanical. `search` marks every occurrence of a search query in
// yellow, on top of whatever formatting the text already has.
export default function FormattedText({
  segments,
  defaultColor,
  search,
  searchCurrent,
  onTimecode,
  timecodeColor,
  onNoteLink,
  onNoteLinkHold,
  linkInk,
  linkTint,
  linkTextStyle,
  linkMaxWidth,
  linkGlyph,
}: {
  segments: TextSegment[];
  defaultColor: string;
  search?: string;
  // Which of this text's matches is the current one (0-based), if any.
  searchCurrent?: number;
  // Given (a note that has a video to seek), every "04:32" in the text is
  // a link that plays the video from there.
  onTimecode?: (seconds: number) => void;
  timecodeColor?: string;
  // A word that links to a note: a chip in the line - tapped it opens the
  // note, held its menu (see documentBlocks' NOTE_LINK_OPEN).
  onNoteLink?: (documentId: string) => void;
  onNoteLinkHold?: (documentId: string, label: string) => void;
  linkInk?: string;
  linkTint?: string;
  // The paragraph's own type (size, line, face): a chip is a view set into
  // the line, and text inside a view inherits nothing from the line around
  // it.
  linkTextStyle?: TextStyle;
  // The line's width: a chip longer than that ends in "…" instead of
  // running off the page.
  linkMaxWidth?: number;
  // The arrow in front of a link's words, by its ref (a nested note's
  // points down - see NESTED_GLYPH).
  linkGlyph?: (ref: string) => string;
}) {
  const query = search?.trim().toLowerCase() ?? '';
  let seen = 0;
  return (
    <>
      {segments.map((seg, i) => {
        const decorations = [seg.underline && 'underline', seg.strikethrough && 'line-through']
          .filter(Boolean)
          .join(' ');
        const style = {
          fontWeight: seg.bold ? ('700' as const) : ('400' as const),
          fontStyle: seg.italic ? ('italic' as const) : ('normal' as const),
          textDecorationLine: (decorations || 'none') as 'none' | 'underline' | 'line-through',
          color: seg.color ?? defaultColor,
          backgroundColor: seg.highlight,
        };
        if (seg.noteLink) {
          const id = seg.noteLink;
          const label = seg.text.slice(LINK_GLYPH.length);
          // A CHIP SET INTO THE LINE (the user's, 2026-10-05: blue words,
          // the diagonal arrow in front, rounded corners). A run of text
          // cannot round its background on Android, so it is a small view
          // inside the line - one piece, never broken across two lines.
          const ink = linkInk ?? timecodeColor ?? style.color;
          // A view in a line stands with its bottom on the baseline; the
          // words inside it sit a descent above their neighbours unless it
          // is let down by about that much.
          const size = linkTextStyle?.fontSize ?? 16;
          return (
            <View
              key={i}
              style={[chipStyles.chip, { backgroundColor: linkTint, transform: [{ translateY: Math.round(size * 0.22) }] }]}
            >
              <Pressable
                onPress={onNoteLink ? () => onNoteLink(id) : undefined}
                onLongPress={onNoteLinkHold ? () => onNoteLinkHold(id, label) : undefined}
                hitSlop={4}
              >
                <Text
                  style={[
                    linkTextStyle,
                    chipStyles.text,
                    { color: ink, lineHeight: undefined },
                    linkMaxWidth ? { maxWidth: linkMaxWidth - CHIP_PAD * 2 - 2 } : null,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {linkGlyph ? linkGlyph(id) : LINK_GLYPH}
                  {label}
                </Text>
              </Pressable>
            </View>
          );
        }
        if (onTimecode && TIMECODE_PATTERN.test(seg.text)) {
          TIMECODE_PATTERN.lastIndex = 0;
          return (
            <Text key={i} style={style}>
              {splitByTimecode(seg.text).map((run, j) =>
                run.seconds === undefined ? (
                  run.text
                ) : (
                  <Text
                    key={j}
                    onPress={() => onTimecode(run.seconds as number)}
                    style={{ color: timecodeColor ?? style.color, textDecorationLine: 'underline', fontWeight: '600' }}
                  >
                    {run.text}
                  </Text>
                )
              )}
            </Text>
          );
        }
        if (!query || !seg.text.toLowerCase().includes(query)) {
          return (
            <Text key={i} style={style}>
              {seg.text}
            </Text>
          );
        }
        return (
          <Text key={i} style={style}>
            {splitByQuery(seg.text, query).map((run, j) =>
              run.match ? (
                <Text key={j} style={{ backgroundColor: seen++ === searchCurrent ? SEARCH_CURRENT : SEARCH_HIGHLIGHT, color: SEARCH_INK }}>
                  {run.text}
                </Text>
              ) : (
                run.text
              )
            )}
          </Text>
        );
      })}
    </>
  );
}

const CHIP_PAD = 5;

const chipStyles = StyleSheet.create({
  chip: {
    borderRadius: 7,
    paddingHorizontal: CHIP_PAD,
  },
  text: { fontWeight: '600' },
});
