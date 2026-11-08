
## Google Cloud: вхід через Google і YouTube API (2026-11-08)

- **Що:** вхід в акаунт Google, щоб застосунок читав підписки YouTube і свіжі відео каналів (офіційний YouTube Data API v3).
- **Де:** console.cloud.google.com → проєкт **`video-bookmark-app`** (номер 517842042497; це проєкт ще з viBo —
  новий проєкт створити не вдалось, ліміт проєктів акаунта вичерпаний; mindEva і її Firebase НЕ чіпали).
- **Що зроблено в консолі (користувач, за підказками):**
  1. YouTube Data API v3 — увімкнено.
  2. Google Auth Platform → Data Access → додано область `https://www.googleapis.com/auth/youtube.readonly`.
  3. Audience: External, стан «Testing», тестовий користувач — solocareaqua360@gmail.com.
  4. Clients → Create client → **Android**: пакет `com.bearlessnotes.app`, відбиток SHA-1
     `F1:48:59:31:3C:9C:64:1D:31:45:98:BD:DD:1A:96:9D:6A:5B:9E:AB`, галочка «Enable custom URI scheme».
     Client ID: `517842042497-q9prjb6h04u9toh3lhdfq3ac1crm59rn.apps.googleusercontent.com` (у `constants/google.ts`; не секрет).
  (Старий клієнт типу Web у цьому проєкті — для viBo через Supabase — НЕ чіпати.)
- **Навіщо:** без входу канали додаються лише посиланнями, дані береться зі сторінок каналів (може зламатись).
- **У застосунку:** `app.json` → `scheme` має два значення (`bearlessnotes` і `com.bearlessnotes.app`: на другий Google
  повертає після входу), сторінка `app/oauth2redirect.tsx` приймає це повернення. Вхід: Налаштування або Канали → «+».
- **Перевірено на телефоні:** вхід, «Google підключено», список підписок (через API).
- **Ще треба (необов'язково, дрібно):**
  - Branding → App name: зараз на екрані згоди «Video Bookmark App», поміняти на «Cinema».
  - Audience → «Publish app» (перейти з Testing на In production): інакше вхід злітає кожні 7 днів. Google покаже
    «застосунок не перевірений» — це нормально для особистого використання (до 100 користувачів).
- **Ліміти:** безкоштовно; 10 000 балів на добу (читання списку = 1 бал); без оплати.
