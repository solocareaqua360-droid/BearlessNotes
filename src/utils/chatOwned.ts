import { parseOutline, type OutlineNode } from './outlineToBoard';
import type { DocOwner } from './recordNotes';
import type { StructNode } from './structureTree';

// WHAT A CONVERSATION OWNS (2026-10-24). A note or board the AI makes in a conversation lives IN it - `owner:
// {kind:'chat', id}` on the document (the way «Склейка» does, utils/chatGlue) - and is left out of the explorer, the
// lists and the search until the user saves it (utils/chatObjects.promoteChatObject). This file holds what every list
// needs to leave them out, and the pure conversions; the Firestore side is utils/chatObjects.

export const chatOwner = (chatId: string): DocOwner => ({ kind: 'chat', id: chatId });

// True for any document or board that belongs to a conversation (`chatId`: to that one). Safe on anything.
export function isChatOwned(data: unknown, chatId?: string): boolean {
  const owner = (data as { owner?: { kind?: unknown; id?: unknown } } | null | undefined)?.owner;
  if (!owner || owner.kind !== 'chat') return false;
  return chatId === undefined || owner.id === chatId;
}

// The AI's outline text (Markdown headings) as a tree of StructNodes, depth = place in the tree (a skipped `#` level nests).
export function nodesFromOutline(text: string): StructNode[] {
  const parsed = parseOutline(text);
  const out: StructNode[] = [];
  parsed.forEach((n, i) => {
    out.push({
      id: `n${i}`,
      title: n.title,
      body: n.body ? n.body.split('\n').map((l) => l.trim()).filter(Boolean) : [],
      parent: n.parent === null ? null : `n${n.parent}`,
      depth: n.parent === null ? 1 : out[n.parent].depth + 1,
      seeAlso: [],
    });
  });
  return out;
}

// A tree as the outline nodes the board layout and the outline-to-board code read (parent = index).
export function toOutlineNodes(nodes: StructNode[]): OutlineNode[] {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  return nodes.map((n) => ({
    title: n.title,
    body: n.body.join('\n'),
    depth: n.depth,
    parent: n.parent === null ? null : index.get(n.parent) ?? null,
  }));
}
