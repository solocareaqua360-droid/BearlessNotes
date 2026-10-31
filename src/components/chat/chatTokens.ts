import type { SoftTokens } from '../../theme/soft';

// The few colours of the chat's sketches (fin1-fin9) that the soft tokens do not name: the warm wash behind the AI's own
// pieces, the tile ground under a picture, the dock's card, the circles in it, and the accent of the send button.
export function chatColours(S: SoftTokens) {
  return {
    wash: S.dark ? '#534034' : '#F9EAE0',
    tileGround: S.dark ? '#2B2B2D' : '#F4F1EC',
    dockCard: S.dark ? '#1F1F21' : '#FFFFFF',
    circle: S.dark ? '#2C2C2F' : '#F2EFEA',
    send: S.dark ? '#E8A06C' : '#D9793F',
    faint: S.dark ? '#6A6964' : '#A9A79F',
    darkBtn: S.dark ? '#F1F0EC' : '#1E1E1C',
    darkBtnInk: S.dark ? '#141413' : '#FFFFFF',
  };
}
