#!/bin/sh
# Randomised check of src/utils/structureTree.ts. No app, no emulator: compiles the pure files and runs node.
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
node -e "
const ts = require('typescript'), fs = require('fs');
for (const f of ['structureTree', 'outlineToBoard']) {
  const out = ts.transpileModule(fs.readFileSync('src/utils/' + f + '.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  fs.writeFileSync('$TMP/' + f + '.js', out.outputText);
}
fs.writeFileSync('$TMP/documentBlocks.js', 'exports.generateId = () => String(Math.random());');
"
cp "$TMP/documentBlocks.js" "$TMP/documentBlocks.js" 2>/dev/null || true
node scripts/structure-fuzz.mjs "$TMP"
