import type { Thought } from '../../hooks/useThoughts';
import { readable } from './ThoughtCapture';

// What a thought is called on its card, and what is read aloud for it - one place, so the card, the reader and the
// voice say the same thing.
export function cardTitle(t: Thought) {
  const src = t.source;
  if (t.ai === 'answer' && t.question) return t.question;
  if (t.ai === 'summary') return 'Резюме';
  if (src?.kind === 'link') return src.title || src.siteName || src.url;
  if (src?.kind === 'text') return readable(src.text);
  // A picture alone has no words of its own: the card shows the picture, and the voice says only that it is one.
  return '';
}

export function voiceTextOf(t: Thought): string {
  const src = t.source;
  const parts: string[] = [];
  if (t.ai === 'answer' && t.question) parts.push(`Питання: ${t.question}.`);
  if (src?.kind === 'link') {
    parts.push(src.title || src.siteName || '');
    if (t.videoGist) parts.push(t.videoGist);
  }
  if (src?.kind === 'text') parts.push(readable(src.text));
  if (t.felt) parts.push(src ? `Що зачепило: ${t.felt}` : readable(t.felt));
  return parts.filter(Boolean).join('\n\n');
}
