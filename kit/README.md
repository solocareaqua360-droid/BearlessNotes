# kit — заморожений стиль mindEva (довідка)

`mindeva-2026-11-07/` — знімок із mindEva (мітка `style-freeze-2026-11-07`):

- `theme/` — тема, шкала розмірів, схеми кольорів (`soft.ts` «М'який», `tokens.ts`,
  `scheme.ts`, `scale.ts`, `desktopTheme.ts`, `ThemeProvider.tsx`).
- `icons/` — `Ionicons.tsx` (усі іконки насправді малює Lucide) + `lucideIcons.ts`.
  Прошарок: ім'я Ionicons без суфікса `-outline` → Lucide.
- `fonts/` — M PLUS Rounded 1c (основний), PT Serif, Roboto Mono, «Hand»; ліцензії
  в `LICENSES.txt` (+ OFL у корені mindEva).
- `ui-reference/` — скріншоти й README про справжній інтерфейс (дорожня карта вигляду).
- `docs/services-and-settings.md` — які консолі/налаштування були потрібні mindEva.
- `mindeva-components-list.txt` — **імена** всіх компонентів mindEva. Код не
  скопійовано (він залежить від усієї mindEva). Якщо потрібен конкретний
  (наприклад `GlassLayer`, `DockFrost`, `HoldMenu`, `FlipModal`) — прочитай його в
  `~/BearlessNotes/src/components/` (лише читати) і перенеси **мінімальну**
  версію сюди.

Це не підключено до застосунку. У `theme/` та `components/ui/` самого Cinema вже є
ранній порт (знімок 2026-10-04); порівняй з цим знімком і взяти новіше.

Що змінилось у mindEva після знімка:

```
git -C ~/BearlessNotes log --oneline style-freeze-2026-11-07..HEAD
```
