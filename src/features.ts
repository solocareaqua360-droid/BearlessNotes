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
} as const;
