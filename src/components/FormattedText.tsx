import { Text } from 'react-native';
import type { TextSegment } from '../utils/documentBlocks';
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
  onTimecode,
  timecodeColor,
}: {
  segments: TextSegment[];
  defaultColor: string;
  search?: string;
  // Given (a note that has a video to seek), every "04:32" in the text is
  // a link that plays the video from there.
  onTimecode?: (seconds: number) => void;
  timecodeColor?: string;
}) {
  const query = search?.trim().toLowerCase() ?? '';
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
                <Text key={j} style={{ backgroundColor: SEARCH_HIGHLIGHT, color: SEARCH_INK }}>
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
