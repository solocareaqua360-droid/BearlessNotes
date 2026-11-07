// Randomised check of src/utils/structureTree.ts: whatever a user does to a note or a board, the tree the AI
// reads must stay valid. Run through scripts/test-structure.sh (it compiles the two .ts files first).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dir = process.argv[2];
const { blocksToStructure, boardToStructure, structureToOutline } = require(`${dir}/structureTree.js`);
const { parseOutline } = require(`${dir}/outlineToBoard.js`);

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const int = (n) => Math.floor(rnd() * n);
const pick = (a) => a[int(a.length)];
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = int(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const WORDS = ['Агент', 'Цикл', 'RAG', 'Пам\'ять', '**жирний**', '`код`', '# хеш', '## ще', '', '   ', 'a', 'Дуже довгий заголовок '.repeat(6), 'x\ny', '```', '- пункт', '1. один'];
const text = () => Array.from({ length: 1 + int(3) }, () => pick(WORDS)).join(rnd() < 0.3 ? '\n' : ' ');
const clean = (t) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`/g, '').trim();

let failures = 0;
const fail = (msg, extra) => { failures++; if (failures <= 8) console.log('FAIL:', msg, extra ? JSON.stringify(extra).slice(0, 500) : ''); };

function checkTree(nodes, label, extra) {
  const ids = new Map();
  nodes.forEach((n, i) => {
    if (ids.has(n.id)) fail(`${label}: duplicate id ${n.id}`, extra);
    ids.set(n.id, i);
  });
  nodes.forEach((n, i) => {
    if (n.parent === null) { if (n.depth !== 1) fail(`${label}: root depth ${n.depth}`, extra); return; }
    const pi = ids.get(n.parent);
    if (pi === undefined) return fail(`${label}: missing parent`, extra);
    if (pi >= i) fail(`${label}: parent after child`, extra);
    if (nodes[pi].depth + 1 !== n.depth) fail(`${label}: depth not parent+1`, extra);
  });
  for (const n of nodes) for (const s of n.seeAlso) if (!ids.has(s)) fail(`${label}: seeAlso points nowhere`, extra);
  for (const n of nodes) for (const r of n.refs ?? []) if (!ids.has(r)) fail(`${label}: ref points nowhere`, extra);
}

function checkOutline(nodes, label, extra) {
  if (nodes.length === 0) return;
  for (const opt of [{ seeAlso: false }, { seeAlso: true }]) {
    const parsed = parseOutline(structureToOutline(nodes, opt));
    if (parsed.length !== nodes.length) return fail(`${label}: outline count ${parsed.length} != ${nodes.length}`, extra);
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    parsed.forEach((p, i) => {
      const want = nodes[i];
      const expectTitle = clean(want.title.replace(/^#+\s*/, '').trim() || 'Без назви');
      if (p.title !== expectTitle) fail(`${label}: title '${p.title}' != '${expectTitle}'`, extra);
      const wantParent = want.parent === null ? null : idx.get(want.parent);
      if (p.parent !== wantParent) fail(`${label}: parent ${p.parent} != ${wantParent} at ${i}`, extra);
    });
  }
}

// ---- documents ----
for (let t = 0; t < 4000; t++) {
  const blocks = Array.from({ length: int(14) }, (_, i) => {
    const kind = pick(['heading', 'heading', 'paragraph', 'paragraph', 'bulleted', 'numbered', 'checkbox', 'image', 'divider', 'table', 'toggle']);
    return { id: `b${i}`, type: kind, text: text(), headingLevel: kind === 'heading' ? 1 + int(4) : undefined, imageTitle: kind === 'image' && rnd() < 0.5 ? 'Фото' : undefined };
  });
  const nodes = blocksToStructure(blocks, 'Нотатка');
  checkTree(nodes, 'doc', blocks);
  checkOutline(nodes, 'doc', blocks);
  if (JSON.stringify(nodes) !== JSON.stringify(blocksToStructure(blocks, 'Нотатка'))) fail('doc: not deterministic', blocks);
  // Nothing lost: every line of text a non-heading block carries lands in some node's body.
  const bodies = nodes.flatMap((n) => n.body).join('\n');
  for (const b of blocks) {
    if (b.type === 'heading' || ['image', 'divider', 'table'].includes(b.type)) continue;
    for (const l of b.text.split('\n').map((x) => x.trim()).filter(Boolean)) if (!bodies.includes(l)) fail('doc: lost a line', { l, blocks });
  }
  const headings = blocks.filter((b) => b.type === 'heading');
  if (nodes.filter((n) => !n.synthetic).length !== headings.length) fail('doc: heading count', blocks);
}

// ---- boards ----
for (let t = 0; t < 4000; t++) {
  const n = int(12);
  const cards = Array.from({ length: n }, (_, i) => ({
    id: `c${i}`, type: pick(['paragraph', 'paragraph', 'document', 'image', 'board']), text: text(),
    x: pick([0, 0, 100, 200, int(500)]), y: pick([0, 50, 50, int(500)]), width: 200,
    documentTitle: 'Док ' + i, boardTitle: 'Дошка ' + i, documentPreviewText: rnd() < 0.5 ? text() : undefined,
    copyOf: rnd() < 0.1 && i > 0 ? `c${int(i)}` : undefined,
  }));
  const conns = Array.from({ length: int(n * 2 + 1) }, (_, i) => ({
    id: `k${i}`, fromCardId: rnd() < 0.05 ? 'ghost' : `c${int(Math.max(n, 1))}`, toCardId: `c${int(Math.max(n, 1))}`, kind: pick(['arrow', 'arrow', 'plain', 'doubleArrow', undefined]),
  }));
  const nodes = boardToStructure(cards, conns);
  checkTree(nodes, 'board', { cards, conns });
  checkOutline(nodes, 'board', { cards, conns });
  const real = nodes.filter((x) => !x.synthetic).map((x) => x.id).sort();
  if (JSON.stringify(real) !== JSON.stringify(cards.map((c) => c.id).sort())) fail('board: a card was lost or doubled', { cards, conns });
  const again = boardToStructure(shuffle(cards), shuffle(conns));
  if (JSON.stringify(nodes) !== JSON.stringify(again)) fail('board: depends on input order', { cards, conns });
}

// A very deep chain must not crash and must keep one parent each.
{
  const cards = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, type: 'paragraph', text: '**T' + i + '**', x: i * 10, y: 0, width: 100 }));
  const conns = cards.slice(1).map((c, i) => ({ id: `e${i}`, fromCardId: `d${i}`, toCardId: c.id, kind: 'arrow' }));
  const nodes = boardToStructure(cards, conns);
  checkTree(nodes, 'deep');
  structureToOutline(nodes);
}
console.log(failures === 0 ? 'OK: 4000 documents + 4000 boards, all trees valid' : `FAILED: ${failures} problems`);
process.exit(failures === 0 ? 0 : 1);
