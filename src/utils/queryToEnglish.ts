// The picture libraries are indexed in English, and this app is used in
// Ukrainian. Type "гори" into a search filtered to real photographs and
// exactly nothing comes back - the only Ukrainian-tagged things in there
// are the maps and coats of arms that filter throws away.
//
// So a Cyrillic query is turned into English first. A small glossary
// covers what people actually type at a picture library - and it answers
// instantly, offline, with no request at all. Anything it does not know
// is sent to MyMemory, which translates without an account; if that is
// slow, down, or simply wrong, the original word goes through unchanged
// and the worst case is the empty grid we already had.

const GLOSSARY: Record<string, string> = {
  гори: 'mountains',
  гора: 'mountain',
  море: 'sea',
  океан: 'ocean',
  озеро: 'lake',
  річка: 'river',
  ліс: 'forest',
  дерево: 'tree',
  дерева: 'trees',
  небо: 'sky',
  хмари: 'clouds',
  сонце: 'sun',
  захід: 'sunset',
  світанок: 'sunrise',
  ніч: 'night',
  зорі: 'stars',
  місто: 'city',
  вулиця: 'street',
  дорога: 'road',
  міст: 'bridge',
  будинок: 'building',
  кава: 'coffee',
  чай: 'tea',
  їжа: 'food',
  книги: 'books',
  книга: 'book',
  папір: 'paper',
  зошит: 'notebook',
  документи: 'documents',
  робота: 'work',
  офіс: 'office',
  стіл: 'desk',
  компʼютер: 'computer',
  комп: 'computer',
  техніка: 'technology',
  машина: 'car',
  авто: 'car',
  вантажівка: 'truck',
  потяг: 'train',
  літак: 'airplane',
  квіти: 'flowers',
  трава: 'grass',
  сад: 'garden',
  тварини: 'animals',
  кіт: 'cat',
  собака: 'dog',
  сніг: 'snow',
  зима: 'winter',
  осінь: 'autumn',
  весна: 'spring',
  літо: 'summer',
  дощ: 'rain',
  вода: 'water',
  вогонь: 'fire',
  камінь: 'stone',
  пісок: 'sand',
  метал: 'metal',
  бетон: 'concrete',
  тканина: 'fabric',
  текстура: 'texture',
  фон: 'background',
  візерунок: 'pattern',
  абстракція: 'abstract',
  мінімалізм: 'minimal',
  спорт: 'sport',
  музика: 'music',
  мапа: 'map',
  карта: 'map',
  подорож: 'travel',
  гроші: 'money',
  наука: 'science',
  здоровʼя: 'health',
  ідея: 'idea',
};

const CYRILLIC = /[Ѐ-ӿ]/;
const cache = new Map<string, string>();

async function askMyMemory(text: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    // A translation is a nicety, not the feature - it must never be what
    // makes a search feel slow.
    const timer = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=uk|en`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = (await response.json()) as { responseData?: { translatedText?: string } };
    const translated = data.responseData?.translatedText?.trim();
    // It hands the word back unchanged when it has no idea - which is not
    // a translation, and pretending otherwise would cache a dead end.
    if (!translated || CYRILLIC.test(translated)) return null;
    return translated;
  } catch {
    return null;
  }
}

export async function toSearchTerm(query: string): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed || !CYRILLIC.test(trimmed)) return trimmed;
  const cached = cache.get(trimmed);
  if (cached) return cached;

  const words = trimmed.toLowerCase().split(/\s+/);
  const known = words.map((word) => GLOSSARY[word]);
  if (known.every(Boolean)) {
    const term = known.join(' ');
    cache.set(trimmed, term);
    return term;
  }

  // Not worth a request for one or two letters someone is still typing.
  if (trimmed.length < 3) return trimmed;
  const translated = await askMyMemory(trimmed);
  const term = translated ?? trimmed;
  if (translated) cache.set(trimmed, term);
  return term;
}
