#!/bin/sh
# Every `.web` sibling must export everything its native twin exports.
#
# A missing one is not a quiet no-op. The bundler picks the `.web` file
# whole, so a name it does not have is simply absent at runtime, and the
# first call takes the screen down: "(0 , $.useKeyboardState) is not a
# function", drawn as the app's own crash page over everything.
#
# TypeScript cannot catch this. It resolves `../hooks/useEditorKeyboard`
# to the NATIVE file and type-checks against that, so the web build is
# never type-checked against what it actually ships.
#
# And the gap can sit there unseen for months: useKeyboardState was
# missing for as long as the browser only ever drew one column, because
# the only caller is the editor and a narrow window never mounts it
# beside the list. The Mac window is wide by default, and found it in a
# minute.
#
# Run after adding an export to any module that has a `.web` sibling.
cd "$(dirname "$0")/.."
python3 - <<'PY'
import pathlib, re, sys

def exports(path):
    text = path.read_text()
    names = set()
    for m in re.finditer(r'^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)', text, re.M):
        names.add(m.group(1))
    for m in re.finditer(r'^export\s+(?:type|interface)\s+(\w+)', text, re.M):
        names.add(m.group(1))
    # `export type { ... }` counts too - it is how a .web sibling most
    # often satisfies a type its native twin declares.
    for m in re.finditer(r'^export\s+(?:type\s+)?\{([^}]*)\}', text, re.M):
        for part in m.group(1).split(','):
            part = part.strip()
            if part:
                names.add(part.split(' as ')[-1].strip())
    if re.search(r'^export\s+default', text, re.M):
        names.add('default')
    return names

problems = []
for web in sorted(pathlib.Path('src').rglob('*.web.*')):
    stem = web.name.split('.web.')[0]
    twins = [p for p in web.parent.glob(stem + '.*')
             if '.web.' not in p.name and p.suffix in ('.ts', '.tsx')]
    if not twins:
        continue
    missing = exports(twins[0]) - exports(web)
    if missing:
        problems.append((web, twins[0], sorted(missing)))

if not problems:
    print('ok - every .web sibling exports everything its native twin does')
    sys.exit(0)

for web, native, missing in problems:
    print(f'{web}')
    print(f'  native: {native}')
    print(f'  missing: {", ".join(missing)}')
print()
print('A type-only export is harmless (types do not exist at runtime).')
print('A function or constant is not: add it to the .web file.')
sys.exit(1)
PY
