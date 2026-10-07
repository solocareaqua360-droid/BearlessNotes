// WHAT IS SHOWN, AND WHAT IS PUT AWAY FOR NOW (the user's triage,
// 2026-10-06: "не додавати функцію в реліз якщо вона не дороблена").
// A feature switched off here loses its buttons, menu rows and tiles; its
// code stays, and whatever it already made (a sticker block in a note, a
// timecode in a lesson's text) still shows. One line brings it back.
export const FEATURES = {
  // «Кадр»: a frame from a playing video into a board or a note.
  videoFrames: false,
  // «Таймкод»: the current moment of a video into a note.
  timecodes: false,
  // «Стікери»: the database, its tile and rows, the strip, the composer.
  stickers: false,
  // Чат: «не розібране» / «відкладене» - the count on the funnel, the state
  // rows in its menu, «Відкласти» in a message's own menu. Off: the chat
  // is exactly what it was.
  chatSorting: true,
  // Чат у лівому шарі, на місці шторки календаря: a switch «календар | чат»
  // in the layer's bar, the swipe from the left edge opens the page last
  // used (the chat at first). Off: the layer is the calendar alone.
  chatInLeftLayer: true,
  // Дошка чату як КАМЕРА над столом (ChatDayCamera): картки лежать один раз,
  // щипок наближає/віддаляє весь стіл і зупиняється на одній із трьох висот.
  // Off: the board re-flows its cards one, two or four to a row, as before.
  chatBoardCamera: true,
  // Копії карток на столі дошки (chatBoardCopies) - відкладено: дошка це
  // чат, відзумлений; склейка піде кнопкою. Код лишається.
  chatBoardCopies: false,
} as const;
