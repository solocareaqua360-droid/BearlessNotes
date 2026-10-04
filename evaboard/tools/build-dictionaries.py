# Builds evaBoard's word lists (app/src/main/assets/ime/eva-dict/<lang>.txt) from the FrequencyWords lists
# (https://github.com/hermitdave/FrequencyWords, content CC-BY-SA-4.0, derived from OpenSubtitles):
#   python3 evaboard/tools/build-dictionaries.py <folder with uk_50k.txt en_50k.txt ru_50k.txt>
# Each output line: word<TAB>count, lowercase, apostrophes normalised to U+02BC, cleaned of foreign-script noise.
import os, re, sys

src = sys.argv[1]
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'src', 'main', 'assets', 'ime', 'eva-dict')
os.makedirs(out_dir, exist_ok=True)

LANGS = {
    'uk': (r"^[а-щьюяєіїґʼ]+(?:-[а-щьюяєіїґʼ]+)?$", set('я в з і й у а о'.split()), 40000),
    'en': (r"^[a-zʼ]+$", set('a i'.split()), 40000),
    'ru': (r"^[а-яё]+(?:-[а-яё]+)?$", set('я в с к у о а и'.split()), 40000),
}
for lang, (pattern, singles, limit) in LANGS.items():
    rx = re.compile(pattern)
    kept = []
    for line in open(os.path.join(src, f'{lang}_50k.txt'), encoding='utf-8'):
        parts = line.split()
        if len(parts) != 2 or not parts[1].isdigit():
            continue
        word = parts[0].lower().replace("'", 'ʼ').replace('’', 'ʼ').replace('`', 'ʼ')
        count = int(parts[1])
        if word.startswith('ʼ') or word.endswith('ʼ') or len(word) > 30:
            continue
        if len(word) == 1 and word not in singles:
            continue
        if not rx.match(word):
            continue
        kept.append((word, count))
        if len(kept) >= limit:
            break
    merged = {}
    for w, c in kept:
        merged[w] = merged.get(w, 0) + c
    if lang == 'uk':
        # Subtitles mix the languages: a Ukrainian-alphabet word that Russian uses far more often, and that has none
        # of the letters only Ukrainian has, is Russian ("привет", "потому") - leave it out of the Ukrainian list.
        ru_counts = {}
        for line in open(os.path.join(src, 'ru_50k.txt'), encoding='utf-8'):
            parts = line.split()
            if len(parts) == 2 and parts[1].isdigit():
                ru_counts[parts[0].lower()] = int(parts[1])
        merged = {w: c for w, c in merged.items()
                  if re.search('[іїєґ\u02bc]', w) or ru_counts.get(w, 0) <= 3 * c}
    rows = sorted(merged.items())  # alphabetical: the engine binary-searches it
    with open(os.path.join(out_dir, f'{lang}.txt'), 'w', encoding='utf-8') as f:
        for w, c in rows:
            f.write(f'{w}\t{c}\n')
    print(lang, len(rows), 'words', os.path.getsize(os.path.join(out_dir, f'{lang}.txt')) // 1024, 'KB')
