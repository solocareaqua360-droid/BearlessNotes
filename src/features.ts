// WHAT IS SHOWN, AND WHAT IS PUT AWAY FOR NOW (the user's triage,
// 2026-10-06: "не додавати функцію в реліз якщо вона не дороблена").
// A feature switched off here loses its buttons, menu rows and tiles; its
// code stays, and whatever it already made (a sticker block in a note, a
// timecode in a lesson's text) still shows. One line brings it back.
export const FEATURES = {
  // THE AI CONVERSATION, step 1 (2026-10-22, the user's «так»): a round button beside «+» on the start desks opens
  // screens/AssistantScreen - live Gemini, answers as blocks, a block held is remembered / told in more detail / copied.
  // Off: the button is gone; the conversation kept on the phone stays.
  assistant: true,
  // «В нотатку» as a TREE: a nested note per branch + a board that shows them (2026-10-23 night). Put away the next day
  // (the user: «їй на даний момент треба вернути форму звичайного документа, без всяких дошок... я тільки розбираюсь»):
  // off = ONE ordinary note, each branch a heading in it (utils/assistantTree writeMemoryNote). Notes and boards made as a
  // tree stay as they are.
  assistantTree: false,
  // «Проєкти» у «Стилі провідника» (2026-10-22): смуга-гармошка проєктів на першому рівні, папки лише вибраного проєкту, «Без проєкту» першим.
  explorerProjects: true,
  // The explorer shows photos, videos, geo points and links ONLY when they were put in a folder (by the «+» inside
  // a folder or by «Папки» on the item); unfiled ones stay in their own bases (2026-10-11, the user's step 1).
  // Files and notes are shown as before. One line brings the old behaviour back.
  explorerFiledOnly: true,
  // A board opens from its card in the explorer by ZOOMING in (components/BoardZoomFrame). An experiment
  // (2026-10-11). REVERTED the same day (flag off): the user saw it and called it «жахливо» - zoom into the
  // picture window + diagonal whitening, chrome not carried. The code stays (utils/boardZoom, components/
  // BoardZoomFrame); a board opens plainly again. Rethink before any retry.
  boardZoom: false,
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
  // THE CHAT IN THE LEFT LAYER - ARCHIVED (2026-10-15, the user's: «чат зі шторки можна заархівувати і помітити як
  // те, що вийшло і нормально функціонує, але в ході проекту відмінилось як рішення»). It worked; the decision changed:
  // the thought flow («Думки») took over catching what comes in. Off: no swipe from the left edge opens it. The chat
  // itself, its messages and its tile among the bases are untouched - true brings the layer back as it was.
  chatDrawer: false,
  // Дошка чату як КАМЕРА над столом (ChatDayCamera): картки лежать один раз,
  // щипок наближає/віддаляє весь стіл і зупиняється на одній із трьох висот.
  // Off: the board re-flows its cards one, two or four to a row, as before.
  chatBoardCamera: false,
  // Склейка: думки з чату, зліплені в чернетку, яку можна переглянути й
  // поправити (ChatGlueSheet, utils/chatGlue). Off: no glue anywhere.
  chatGlue: true,
  // Дошка на телефоні: праворуч у доці кругла кнопка «назад» (вихід з
  // дошки), а «+» став останнім пунктом у смужці інструментів. Off: «+»
  // знову кругла кнопка праворуч.
  boardDockBack: true,
  // Дошка дня: плаваюча кнопка на екрані дня в календарі відкриває дошку
  // цього дня з карткою «Аркуш дня» (utils/dayBoard). Off: no button.
  dayBoard: true,
  // «Передати Claude»: a button in the tasks' selection mode that copies the
  // chosen NEW tasks as text, flips them to «У роботі» and numbers the
  // batch. Off: no button, no chip.
  claudeHandoff: true,
  // «Справи» v2 (ескіз «Шлях справи», 2026-10-09): головний список видів
  // (Вхідні / Сьогодні / Найближчі / Колись / Зроблено / проєкти) - кожен
  // окремим вікном, кнопки лише на відкритій картці, «Коли?». Off: the
  // old screen with project tabs, exactly as before.
  tasksV2: true,
  // ПРОБА: картка-документ на дошці дня відкривається маленьким вікном
  // з редактором поверх дошки (телефон). Off: дотик розгортає картку.
  cardWindow: true,
  // ПРОБА (2026-10-19): блок, у якому пишеш, показує форматування (жирне, курсив, колір...) прямо під час набору -
  // без позначок. Off: як раніше, активний блок одного стилю.
  liveFormat: true,
  // «Що лишити?»: при видаленні дошки вікно питає, що з лежачого на ній
  // (фото, файли, посилання, нотатки, дошки) теж піде в кошик, а що
  // лишиться в базах. Off: the plain «Видалити дошку?» as before.
  deleteAsksContents: true,
  // Проєкти для папок: у меню затискання папки рядки «Проєкти…» і «Вигляд
  // картки» (розмір, колір із палітри, два описи). Off: меню як було.
  projectFolders: true,
  // Універсальні папки (етап 1a плану єдиного провідника): папка, створена у
  // вікні проєктів, — один теґ для всіх видів предметів (документи, дошки,
  // картки, фото, файли, посилання), а не окремий теґ на кожен вид.
  // Off: як було (теґ виду «документ»; решта видів — власні теґи того ж шляху).
  universalFolders: true,
  // ЄДИНИЙ ПРОВІДНИК, крок 2 (лише перегляд): плитка «Провідник» у «Базах» -
  // папки й речі без папки разом, усі шість видів. Нічого не пише в дані.
  // Off: плитки нема.
  singleExplorer: true,
  // Провідник виду показує лише папки, де є предмети цього виду, і папки над
  // ними (порожня універсальна папка - лише в загальному провіднику). Off:
  // усі папки, що мають цей вид у `types`.
  explorerFoldersByContent: true,
  // Копії карток на столі дошки (chatBoardCopies) - відкладено: дошка це
  // чат, відзумлений; склейка піде кнопкою. Код лишається.
  chatBoardCopies: false,
  // EXPERIMENT (2026-10-11, the user's: the explorer should be the main screen). The phone's first desk is the
  // explorer instead of the start screen («Нещодавні» come back as a strip later, if it holds). Off: the start screen.
  // First try (2026-10-11) reverted the same night: the explorer drew its OWN top bar, which stood over every layer.
  // Second (2026-10-12, ON): ExplorerScreen `desk` - the island draws the bar, the path is published to it, the
  // filter chips claim an edge zone; walked on the phone through both drawers, folders, a note, Справи, back keys.
  startIsExplorer: true,
  // The media bases (video, links, geo points, photos) keep NO folders of their own (2026-10-12, the user's: «відео
  // залишиться без папок як і посилання і фото, все переміститься в корені своїх баз»): their records stand at the
  // base's root; the explorer alone files them («У провідник…» stays), and taking one out of a folder there never
  // deletes it. Nothing in the data changes - the folder tags are kept, so one line brings the old folders back.
  mediaWithoutFolders: true,
  // The calendar as the phone's second desk, right after the explorer (2026-10-12, the user's); the left layer then
  // holds only the chat. Off: the calendar is the left layer's page again.
  calendarDesk: true,
  // The bases list as the third fixed desk; the right layer is gone (2026-10-12, the user's). Off: the layer again.
  basesDesk: true,
  // The «Проєкти» screen put away (2026-10-12, the user's: what was good there - the folder cards and their panes -
  // moved to the explorer as «Стиль провідника: Модерний»; the rest waits for real use). Off: no «Проекти» row
  // among the bases. The data and the «Проєкт» field on records stay.
  projectsScreen: false,
  // The calendar desk as one column of days (components/CalendarRiver): today's note and board, the tasks of each
  // day, «•••» on every day. The day page stays in «⋯» («Вигляд дня»). Off: the day page as before.
  calendarRiver: true,
  // A day's note shows, under its title, the tasks of that day that live elsewhere (components/DayTasksBlock).
  dayTasksBlock: true,
  // The bottom dock on the three desks' own screens (2026-10-12, the user's sketch): the three desks and the search
  // lens in one white pill on the left, "+" and the multitasking circle on the right; going into a folder or a
  // base, the lens leaves the pill as a drop, joins "+" and the search field grows out to the left. Off: the old
  // dock (the search field with "+" inside, the multitasking circle beside it).
  deskDock: true,
  // THE OPEN DESKS AS PICTURES (the tab switcher: the dock's right circle on a root desk, a tap on the desk in front in the
  // top pill, a pull-and-hold). REMOVED 2026-10-23 - the user's verdict: «красиве, але не знадобилось»; with only three
  // desks (threeDesks) there is no multitasking left to switch between, and the desks were photographed in the
  // background (navigation/deskShots, captureRef of a whole screen) - theoretically a cost on the thread that takes taps.
  // Off: no captures, no switcher, no circle on a root desk (an empty place there for now). The code stays.
  deskSwitcher: false,
  // EXPERIMENT (2026-10-19, the user's): only the three desks. No sideways swipe between them (the dock's beads
  // switch), no extra windows - every base, the documents and the boards too, opens inside, over the Бази desk. The
  // freed swipe is to become selection (swipe left, like Craft). Phone only; the stored list of extra desks is left
  // as it is, so off brings them back.
  threeDesks: true,
  // Swipe to select, like Craft (2026-10-19, the user's): a swipe LEFT on a block picks it and turns select mode on;
  // the finger carried on picks the blocks it passes; swiping the last picked one off ends the mode. Step 2 of the
  // experiment: the note's blocks. Off: the swipe does nothing, as before.
  swipeSelect: true,
  // «Нерозкладене» (2026-10-19, the user's): the start screen shows only folders, and what is in none sits in one more
  // folder, first, made by the explorer itself (ExplorerScreen's UNFILED). Off: the «Без папки» list under the folders.
  unfiledFolder: true,
  // THE MAC'S FRAME B (2026-10-19, the user's: «роби Б», after Claude's own window): one left Sidebar (search, Новий,
  // sections, folder tree, bases, account) instead of the rail + tab row + start page + side panels as navigation;
  // the explorer is the home. Off: the old rail/tabs/start page.
  macFrameB: true,
  // The chrome steps back while a list is scrolled down (navigation/chromeScroll; the explorer feeds it): the top
  // bar keeps the way back and the title at half strength, the dock keeps "+" and its circle at half strength.
  // Scrolling up, the top of the list, or leaving the screen brings it all back. Off: the chrome never moves.
  chromeCompact: true,
  // The «+» opens the QUICK-CREATE window (components/QuickCreate): one field, what it is and which folder chosen
  // after; the rest of what can be made behind «⋯», by group. The «+» fan below is ARCHIVED (the user, 2026-10-13: it
  // worked and was beautiful and was not needed): its code stays (components/CreateFan), createFan false.
  // The bases list as GROUPS OF WHITE CARDS (the user's proposal, 2026-10-13, a screenshot of the projects accordion): each
  // section of the list is one white rounded card, its rows an icon in a grey chip, the name, the count. The beige
  // ground stays everywhere (the user: changing the canvas colour was a strange idea) - the white cards are what
  // lifts it. Off: the plain rows.
  basesCards: true,
  // Opening a folder in «Модерний»: the content is mounted AT ONCE with the folder and starts arriving under the growing
  // cover (2026-10-14: the JS cost of the content is ~50 ms now that the patterns are pictures, so the cover-first stage
  // only added ~70 ms of waiting and a visible gap). Off: the old two-step (cover, then the things).
  openOneStep: true,
  // The item cards' type colour as a small corner glow (components/CornerGlow) - the agreed look of 2026-10-14. Off: plain.
  // A folder holding only photos / only geo points opens as a COLLECTION window (components/CollectionWindow): a big stage
  // on top (the photo / a map of all its points), the rest below. Off: an ordinary folder.
  collections: true,
  // A collection's card shows what is in it, not a folder icon (2026-10-15, «хочу все»): CollectionCard.
  collectionCards: true,
  // THE THOUGHT FLOW, slice 1 (2026-10-15): the living «Думки» folder in the explorer, the space of themes, the window
  // that catches a thought (from the share sheet for links and text, or a hold on the folder) - components/thoughts.
  // Off: none of it shows, and the share sheet asks «куди зберегти?» as before.
  thoughts: true,
  // OUR TONES (2026-10-15, the user, sketch DVZ4tpN3RmdRzmfsv7Mwzn board 2): the pastel card colours, the theme balloons
  // and the cream «Думки» card felt «ванільно» together - everything goes into the app's own tones instead: white,
  // beige, black, grey, and orange only as the accent (the count on a folder). The card colour ids stay the same, so
  // every saved folder is simply repainted. Off: the soft pastel set of 2026-10-10.
  ourTones: true,
  // The media bases' own COLLECTIONS (2026-10-14, the user's): photos / YouTube / geo points get folders again, called
  // «підбірка» / «плейліст», made in the base (Tag.baseOnly) and not shown in the explorer until placed there.
  // Nested levels allowed. Off: the bases keep no folders (mediaWithoutFolders).
  baseCollections: true,
  itemGlow: true,
  // ...replaced (2026-10-19, the user's pick «блідий») by the type's icon in a pale circle in the same corner
  // (components/CornerGlow's TypeBadge). Off: the glow again.
  typeBadge: true,
  // The rest of the agreed item-card look (2026-10-14): list thumbnails all 104x78 like the note's and rows at least 98 tall, a
  // photo in the grid BARE (no date / folder / count over it), a flashcard as TEXT only (no picture on top, no thumbnail in a
  // list row). Off: as before.
  itemLook: true,
  quickCreate: true,
  createFan: false,
  // THE PROJECTS ACCORDION (components/ProjectsBand: a big front card, thin strips that slide, the multitask menu's motion).
  // ARCHIVED 2026-10-25 - the user: it came out well, without problems, but was not needed; the projects are now a row of
  // capsules (components/ProjectCapsules). true brings the accordion back.
  projectsAccordion: false,
  // «СТАРТ» СПИСКОМ (2026-10-28, the user, after Craft's Home; sketch KLjwHTT3F9K7ftbvJYFjs6): on the phone's start desk the
  // explorer's first level is three things only - «Нещодавні» (notes and boards), «Папки» as rows (the folders of no project,
  // «Думки» first, «Кошик» last) and «Проєкти ›» with the projects as rows; a project opens as its own level. false: the
  // capsules of projects and the folder cards, as before.
  startList: true,
  // ВЕРХ БЕЗ СУЦІЛЬНОЇ СМУЖКИ (2026-10-28, the user, sketch 5BJNEhmoz1oz3VkfbHwiFT: «позбавляємось суцільної смужки вгорі»):
  // the bar's capsule under everything is gone - the name or path is text on the left, over the screen's own edge fade, and
  // only the buttons at the right end keep a capsule. false: the one capsule across the top, the name in the middle.
  openTopBar: true,
  // СКЛО, ЩО ЗАЛОМЛЮЄ (2026-10-28, the user over Craft's capsules: the rim lights up in the colour passing under it): the
  // glass capsules (dock, the bar's name and buttons) keep their tint off a thin ring at the edge, so the blur shows there
  // nearly bare - over black the edge stays quiet, a colour passing under it lights the rim. No glow round the capsule.
  // false: the glass as before (tint across, the inner shade rings, the glow).
  glassRefract: true,
  // THE AI'S FIRST SCREEN IS A LIST (2026-10-29, sketch P7vugFh1mrFwyNHjK6bnx3): themes, «Без теми», the latest conversations,
  // the app's dock and «+»; «+» turns into the field, Enter opens the new conversation; a similar one is offered at the top
  // before (found on the phone); the theme is quiet chips in the conversation. false: the window opens into a conversation.
  aiHome: true,
  // THE CONVERSATION BY TOPIC (2026-10-29): «Зміст розмови» in its header - «За часом / По темах», the topics to jump to and
  // «Впорядкувати» (the AI groups the pairs; the real order is kept for it). false: the conversation is only by time.
  aiChatOutline: true,
} as const;
