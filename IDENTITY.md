# Ідентичність застосунку — НЕ створювати наново

Минулого разу налаштування цих речей давалось важко. Усе нижче вже існує й
прив'язане одне до одного. Секретів тут немає (ключ підпису лежить на expo.dev).

| Що | Значення | Де |
|---|---|---|
| Назва | viBo (можна перейменувати лише відображувану `name`) | `app.json` → `expo.name` |
| Android-пакет | `com.bearlessnotes.app` | `app.json` → `android.package` |
| iOS bundle id | `com.bearlessnotes.app` | `app.json` → `ios.bundleIdentifier` |
| Slug / scheme | `bearlessnotes` | `app.json` |
| Проєкт Expo (EAS) | `a5702ee7-33d8-47bf-bcc0-bb5c59951f1b` | `app.json` → `extra.eas.projectId` |
| Ключ підпису Android | створений EAS, лежить у цьому проєкті Expo | expo.dev (не локально) |
| Google OAuth-клієнт | прив'язаний до пакета + SHA-1 ключа (якщо вхід через Google вже налаштований) | Google Cloud Console — перевір перед зміною пакета |
| Канали оновлень | `development`, `preview`, `production` | `eas.json` |

Правила:
- `package`, `bundleIdentifier`, `projectId`, `slug` — **не змінювати**. Інший пакет
  = інший застосунок (Play Store не дозволить повернути).
- Дві різні програми з одним пакетом Android система вважає однією — установка
  замінює стару (viBo → Cinema), дані застосунку лишаються. Для цього застосунку
  це бажано.
- Не плутати з mindEva: її пакет `com.bearlessnotes.notes`, свій проєкт Expo,
  свій ключ — туди не торкатися.
- Якщо колись знадобиться інша ідентичність — це окреме рішення користувача.
