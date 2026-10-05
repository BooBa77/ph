# Инфраструктура проекта PeakHunter

Документ описывает **технологический стек** проекта: какие библиотеки и модули
используются на бэкенде и фронтенде, зачем каждый нужен и как слои связаны.
Хостинг, деплой, CI/CD — в отдельном мануале, здесь их нет.

Версии указаны на момент написания. Если что-то не сходится с `package.json` —
источник истины `package.json`, а не этот файл.

---

## 1. Сводка стека

| Слой | Технология | Версия |
|---|---|---|
| Frontend-фреймворк | Vue | 3.5.43 |
| Frontend-язык | TypeScript | 6.0.2 |
| Сборщик / dev-server | Vite | 8.3.0 |
| Роутинг | Vue Router | 5.2.0 |
| Состояние | Pinia | 4.0.3 |
| Стилизация | Tailwind CSS + @tailwindcss/vite | 4 |
| PWA | vite-plugin-pwa + workbox-window | 1.3.0 / 7.4.1 |
| Backend-фреймворк | NestJS | 12 |
| Backend-платформа | Express (`@nestjs/platform-express`) | 12 |
| ORM | TypeORM | 0.3.20 |
| БД | PostgreSQL + PostGIS | 16 / 3.5 |
| Аутентификация | JWT (`@nestjs/jwt`) + Passport | 12 / 0.7 |
| Валидация | class-validator + class-transformer | 0.15.1 / 0.5.1 |
| Логирование | nestjs-pino + pino | 5.2 / 10.3 |
| Документация API | @nestjs/swagger | 12.0.1 |
| Почта | nodemailer | 10.0.10 |
| Конфиг | @nestjs/config | 12.0.0 |
| Тесты | Vitest + SWC (unplugin-swc) | 5 / 1.16 |
| Среда исполнения | Node.js | 24 |

---

## 2. Backend (NestJS)

### 2.1 Ядро фреймворка

- **`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`** —
  базовый NestJS. Модульная структура: код разбит на модули
  (`AuthModule`, `UsersModule`, `EmailModule`, `HealthModule` и т.д.),
  внутри каждого — контроллеры (роуты), сервисы (логика), DTO.
  Платформа — **Express**, не Fastify. Все стандартные middleware
  Express-совместимы.
- **`reflect-metadata`** — полифилл декораторов. Импортируется напрямую
  в `data-source.ts`: CLI TypeORM работает мимо NestJS, а полифилл
  подключает именно фреймворк.
- **`rxjs`** — транзитивная зависимость NestJS,
  напрямую в коде не используется.

### 2.2 Работа с БД

- **`typeorm` + `@nestjs/typeorm` + `pg`** — ORM для PostgreSQL.
  Сущности проекта: `User`, `AuthIdentity`, `Session`, `DisplayNameHistory`.
  Миграции лежат в `src/migrations/`, запускаются через
  `npm run migration:run`. Подключение к БД описано в
  `src/data-source.ts` и через `TypeOrmModule.forRootAsync()` в `AppModule`.
  Применённые миграции: `Init`, `EnablePostgis`, `InitAuth`,
  `DropUnusedUserFieldsAndAddDisplayNameHistory`.
- **PostgreSQL 16 + PostGIS 3.5** — СУБД. PostGIS даёт геотипы и
  пространственные индексы — понадобится для маршрутов, точек на карте,
  поиска ближайших попутчиков. Пока не используется в логике, но
  расширение установлено (миграция `EnablePostgis`).

### 2.3 Аутентификация и авторизация

- **`@nestjs/jwt`** — выпуск и проверка access-токенов (JWT).
  Payload минимальный: `{ sub: userId }`. Время жизни — 30 минут.
- **`@nestjs/passport` + `passport` + `passport-jwt`** — стратегия
  `JwtStrategy` извлекает access-токен из заголовка `Authorization: Bearer ...`,
  проверяет подпись, возвращает `{ id }`. Глобальный `JwtAuthGuard`
  (через `APP_GUARD`) защищает все роуты, `@Public()` открывает исключения.
- **`cookie-parser`** — разбор `refresh_token` из httpOnly cookie.
  Refresh-токен живёт в cookie (Path=/api/auth, SameSite=Lax, Secure в prod),
  не в localStorage.

Паролей в проекте нет — вход passwordless через код на email.
Refresh-токены хешируются **SHA-256** — этого достаточно, так как
сам токен уже случайная строка с высокой энтропией.

### 2.4 Валидация и DTO

- **`class-validator` + `class-transformer`** — валидация входных данных
  через глобальный `ValidationPipe` с опциями
  `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
  `whitelist` отрезает поля, которых нет в DTO. `forbidNonWhitelisted`
  бросает 400, если пришло лишнее поле. `transform` превращает plain-объект
  в экземпляр DTO-класса.

**DTO в проекте двух видов:**

- **Входные** (`RequestCodeDto`, `VerifyCodeDto`, `UpdateUserDto`) —
  валидируются `class-validator` (`@IsEmail`, `@Matches`, `@MaxLength`,
  `@IsOptional` и т.д.), описаны для Swagger через `@ApiProperty`.
- **Выходные** (`UserResponseDto`, `AuthResponseDto`) — описывают форму
  ответа, маппятся из entity статическим методом `from(entity)`.
  Существуют, чтобы служебные поля entity не утекали в API.

### 2.5 Логирование

- **`nestjs-pino`** — интеграция Pino с NestJS. Подключается через
  `LoggerModule.forRootAsync()` в `AppModule`.
- **`pino`, `pino-http`** — транзитивные зависимости. `pino-http`
  объявлен в `dependencies` явно, но не импортируется: его конфиг
  передаётся через `pinoHttp: {...}` в `LoggerModule.forRootAsync()`.
- В dev используется `pino-pretty` (devDependency) для читаемого вывода.

### 2.6 Прочее

- **`@nestjs/config`** — чтение переменных окружения через `ConfigService`.
  Основной источник переменных — **Docker environment** (секция
  `environment:` в `docker-compose.yml`). `.env`-файла в контейнере нет.
  В prod-окружении переменные приходят так же, через оркестратор.
- **`@nestjs/swagger`** — автогенерация OpenAPI-документации по декораторам.
  На DTO — `@ApiProperty`, на контроллерах — `@ApiTags`, `@ApiOperation`,
  `@ApiOkResponse({ type: ... })`. UI показывает точные схемы запросов
  и ответов, доступен по отдельному роуту (см. `main.ts`).
- **`nodemailer`** — отправка писем. Используется в `SmtpService`
  внутри `EmailModule`. В dev — заглушка: письмо не уходит,
  а логируется в консоль (`[DEV] Письмо не отправлено...`).
  В prod — реальная отправка через smtp.mail.ru.
- **`vitest`** — запуск тестов (`npm test`, `npm run test:e2e`).
  Конфиги — `vitest.config.mts` и `vitest.config.e2e.mts`.
- **`@swc/core` + `unplugin-swc`** — транспиляция TypeScript для тестов
  вместо штатного esbuild. Нужны из-за `emitDecoratorMetadata`: NestJS
  по метаданным типов понимает, что подставлять в конструктор, а esbuild
  их не генерирует — внедрение зависимостей падает.
- **`ua-parser-js`** — парсинг `User-Agent` в `AuthService` при создании
  `Session`. Из заголовка извлекается `device_label` (браузер, ОС),
  который хранится в сессии. Позже это даст список устройств
  с возможностью отозвать сессию на конкретном.

### 2.7 Свои модули проекта

- **`AuthModule`** — passwordless-вход: `request-code`, `verify-code`,
  `refresh`, `logout`. Внутри — `AuthService`, `AuthController`,
  `JwtStrategy`, `JwtAuthGuard`. Возвращает `UserResponseDto` в
  `verify-code` и `refresh` (не entity).
- **`UsersModule`** — работа с пользователями. `UsersService`
  (CRUD, soft delete через `deleted_at`, аудит смены `displayName`
  в `display_name_history`, `update` — в транзакции), `UsersController`
  (`GET /api/users/me`, `PATCH /api/users/me`).
- **`EmailModule`** — `SmtpService` (отправка/логирование писем) и
  `EmailCodeService` (генерация и проверка кодов, cooldown 60с,
  2 попытки, TTL 5 минут, in-memory).
- **`HealthModule`** — роут `/api/health` для проверки, что бэк
  и БД живы. Используется в мониторинге и в `curl`-проверках.

---

## 3. Frontend (Vue)

### 3.1 Ядро

- **`vue@3.5`** — фреймворк. Используется Composition API
  со `<script setup lang="ts">` во всех компонентах.
- **`typescript@6`** — типизация. Версия 6, а не 7 — из-за совместимости
  `vue-tsc` с TS 7 (см. раздел «Версии»).
- **`@vitejs/plugin-vue`** — интеграция Vue в Vite (SFC-компиляция).

### 3.2 Сборка и dev-сервер

- **`vite@8`** — сборщик и dev-server. В dev: мгновенный HMR, проксирование
  `/api` на бэк (`server.proxy` в `vite.config.ts`), watch с polling
  (Windows + Docker). В prod: сборка статики в `dist/`, которую отдаёт nginx.

### 3.3 Роутинг и состояние

- **`vue-router@5`** — маршруты. Глобальный `beforeEach`-guard проверяет
  `requiresAuth` (через `to.matched.some(...)` — для защиты вложенных
  роутов) и `isAuthenticated` из auth-store, редиректит между `/` и `/auth`.
  Роуты: `/`, `/auth`, `/profile` (redirect → `/profile/personal`),
  `/profile/personal`. Vue Router **не наследует** `meta` от родителя
  к детям — поэтому проверка идёт по всей цепочке `matched`.
- **`pinia@4`** — store. Два store:
  - **`useAuthStore`** — user, accessToken, isBootstrapped, setAuth,
    setUser, clear, refreshAccessToken, bootstrap.
  - **`useAppStore`** — isUserBusy (счётчик «юзер занят», для отложенного
    reload при PWA-обновлении), currentTheme (1–4), setTheme.
  Синтаксис — setup-стиль.

**`isBootstrapped`** — флаг «мы уже проверили, залогинен ли юзер при
старте приложения?». Bootstrap делает один запрос POST /api/auth/refresh:
если cookie жива, store получает новый access-токен и user;
если нет — accessToken: null, store остаётся пустым, isBootstrapped = true.
Router-guard вызывает bootstrap один раз на первый переход.

**Темы** — `useTheme()` в `App.vue` (один раз). Определяет сезон по дате
(локальное время браузера), ставит `data-theme` на `<html>`.
Override — через `localStorage.themeOverride` (для dev).

### 3.4 PWA

- **`vite-plugin-pwa`** — генерация service worker и манифеста.
  Стратегия `injectManifest` (свой SW в `src/sw.ts`), `registerType: 'prompt'`
  (без автообновления — рулим вручную). В dev PWA отключена.
- Обновлением управляет `composables/useSwUpdate.ts` — через нативный
  `navigator.serviceWorker`. Обёртка `workbox-window` не нужна и удалена
  из зависимостей.

### 3.5 HTTP-слой

Своего HTTP-клиента (axios и т.п.) **нет** — используется нативный `fetch`,
обёрнутый в `src/api/client.ts` (`apiFetch`). Обёртка даёт:
автоподстановку `Authorization: Bearer`, `credentials: 'include'`
для refresh-cookie, авто-refresh при 401 (single-flight) и один повтор
запроса, разбор JSON/204, бросание `ApiError` при 4xx/5xx.

**Структура `src/api/`:**

- `errors.ts` — класс `ApiError` + хелперы разбора тела ошибки.
- `types.ts` — TS-типы (`User`, `AuthResponse`, `RefreshResponse`,
  `RequestCodeResponse`, `UpdateUserRequest`).
- `client.ts` — `apiFetch<T>`, единая точка для защищённых запросов.
- `auth.ts` — `requestCode`, `verifyCode`, `logout` (прямые `fetch`,
  без `apiFetch`).
- `users.ts` — `getMe()`, `updateMe()` (через `apiFetch`).

**Когда кидается ApiError.** ApiError — это ошибка ответа сервера
со статусом 4xx или 5xx: бэк прислал JSON с полем message,
обёртка его разобрала и бросила `ApiError(status, message, body)`.
Компонент ловит её и решает, что показать
(`e instanceof ApiError && e.status === 400`).

Если сеть упала (сервер недоступен, DNS не разрешился) или бэк вернул
500 без осмысленного тела — fetch либо отклоняется с `TypeError`,
либо `ApiError` содержит `message: "HTTP 500"`. Политика в `apiFetch`
такая: различать «сервер честно сказал 4xx» и «сервер не ответил / упал».
Первое — вина клиента, второе — вина сети/сервера. Компоненту это
позволяет выбрать разные тексты ошибок и разное поведение.

**Однонаправленность зависимостей внутри `api/` и `stores/`.**
Здесь легко получить циклический импорт, и мы его сознательно разорвали:

- `stores/auth.ts` **не импортирует** `api/client.ts`, `api/auth.ts`,
  `api/users.ts` (только `ApiError` из `errors.ts` и типы из `types.ts`).
- `api/client.ts` импортирует `stores/auth.ts` — но `useAuthStore()`
  вызывается **внутри функции**, не на уровне модуля (на момент импорта
  `client.ts` Pinia ещё не инициализирована).
- `api/auth.ts` **не импортирует** store. `requestCode`, `verifyCode`,
  `logout` — прямые fetch, не кладут данные в store.
- `api/users.ts` импортирует `api/client.ts` (через `apiFetch`),
  **не store**.

Смысл: store — про состояние, `api/*` — про HTTP. Компонент их связывает.
Например, `PersonalInfo.vue` зовёт `updateMe()` из `api/users.ts`,
потом `auth.setUser(user)`.

### 3.6 Стилизация и темы

- **`tailwindcss@4` + `@tailwindcss/vite`** — утилитарный CSS-фреймворк.
  Конфигурация — **в CSS** (`@theme inline`), не в JS.
  Токены описаны как CSS-переменные, Tailwind генерирует утилиты.

**Структура:**

- `src/assets/styles/main.css` — `@import "tailwindcss"`,
  `@import "./themes.css"`, `@theme inline` (маппинг `--theme-*` → `--color-*`),
  базовые стили (`html`, `body`, `a`).
- `src/assets/styles/themes.css` — значения `--theme-*` для `:root`
  (дефолт = зима) и `[data-theme="1..4"]`.
- `src/types/theme.ts` — `Season`, `SEASONS`, `isValidSeason`.
- `src/composables/useTheme.ts` — определение сезона по дате, override
  через `localStorage.themeOverride`, watcher с откатом невалидных значений.
- `index.html` — инлайн-скрипт до `main.ts`, ставит `data-theme` на `<html>`
  (защита от FOUC).

**Токены (Tailwind-утилиты):**

| CSS-переменная | Утилиты |
|---|---|
| `--color-bg` | `bg-bg`, `text-bg`, `border-bg` |
| `--color-surface` | `bg-surface`, ... |
| `--color-text` | `text-text`, ... |
| `--color-muted` | `text-muted`, ... |
| `--color-border` | `border-border`, ... |
| `--color-primary` | `text-primary`, `bg-primary`, `border-primary` |

**4 сезона, числа:**

- **1** = зима (8 ноября — 7 марта)
- **2** = весна (8 марта — 24 мая)
- **3** = лето (25 мая — 31 августа)
- **4** = осень (1 сентября — 7 ноября)

Сезон определяется по **локальному времени браузера**, месяц + день
(високосность неважна — границы заданы календарными датами).
В prod — только по дате. В dev — можно переопределить:
`localStorage.setItem('themeOverride', '3')`.

**Адаптив:** breakpoint **768px** (`md:` в Tailwind). Мобильный (≤768px) —
вертикально, десктоп (>768px) — горизонтально. Один DOM, разная раскладка
через утилиты.

### 3.7 Инструменты разработчика

- **`vite-plugin-vue-devtools`** — инспектор Vue/Pinia/Router в браузере.
- **`vue-tsc`** — проверка типов в `.vue`-файлах (Vite сам типы
  не проверяет, только транспилирует).
- **`eslint` + `eslint-plugin-vue` + `@vue/eslint-config-typescript` +
  `eslint-config-prettier`** — линт Vue-специфичных правил и TS.
- **`oxlint` + `eslint-plugin-oxlint`** — второй, быстрый линтер на Rust.
  Работают в паре: `oxlint` ловит очевидное быстро, `eslint` — глубокие правила.
  **Версии должны совпадать** — обновлять парой.
- **`prettier`** — форматирование.
- **`npm-run-all2`** — параллельный запуск скриптов
  (`npm run build` = `type-check` + `build-only`).

---

## 4. Как связаны слои

Запрос от браузера проходит так:

```
Браузер
│ fetch('/api/...') ← тот же origin
▼
Vite dev-server (:5173, dev) / nginx (prod)
│ proxy: /api/* → backend:3000
▼
NestJS (:3000)
│ ValidationPipe (class-validator)
│ JwtAuthGuard (passport-jwt) — если роут не @Public
▼
Сервис (AuthService / UsersService / ...)
│ TypeORM Repository
▼
PostgreSQL + PostGIS (:5432 внутри docker-сети)
```

Обратно:

- JSON-ответ.
- Если эндпоинт выставляет cookie (verify-code, refresh) —
  `Set-Cookie: refresh_token=...; HttpOnly; SameSite=Lax`.
- Фронт получает JSON через `apiFetch`, кладёт `accessToken` в `Pinia`
  (только в памяти, не в localStorage), `user` — туда же.
- Cookie живёт в браузере, JS её не видит (HttpOnly).
  Отправляется автоматически при `credentials: 'include'` и совпадении origin.

**Где что хранится:**

| Данные | Где живут | Время жизни |
|---|---|---|
| access-токен | Pinia (память) | 30 минут |
| refresh-токен | httpOnly cookie | 180 дней, ротируется при каждом refresh |
| refresh-хеш | `sessions.refresh_token_hash` (БД) | до отзыва сессии |
| код подтверждения | `EmailCodeService` (in-memory) | 5 минут |
| user | Pinia (`verify-code`/`refresh` отдают полный профиль) | до logout/refresh-fail |
| currentTheme | Pinia (`useAppStore`) + `<html data-theme>` | сессия вкладки |

---

## 5. Версии — почему именно такие

- **TypeScript 6, не 7** — `vue-tsc@3.3.7` несовместим с TS 7.
  Как только `vue-tsc` догонит — можно обновляться.
- **Vue 3.5, не 2** — Composition API, `<script setup>`,
  лучшая типизация. Vue 2 в 2026 официально EOL.
- **NestJS 12** — актуальная мажорная версия, всё остальное
  (`@nestjs/jwt`, `@nestjs/passport`, `@nestjs/swagger`) подтянуто под неё.
- **Node 24** — LTS-версия. Бэкенд прописан в `engines` как `>=24.9.0`,
  фронт — как `>=24.12.0`. Dev-контейнеры в `docker-compose.yml` и оба
  образа используют `node:24-alpine`; конфиг — `@tsconfig/node24`
  в `tsconfig.node.json`. Прежнее ограничение снизу по версии было
  связано с jest, который не умеет `require(esm)`, — тесты переведены
  на Vitest, и эта зависимость ушла.
- **PostgreSQL 16 + PostGIS 3.5** — PostGIS под эту мажорную версию PG.
- **Pinia 4** — setup-синтаксис, работает поверх Vue 3.5.
- **Tailwind 4, не 3** — конфигурация в CSS (`@theme`), поддержка
  `@theme inline` для динамических тем, официальный Vite-плагин.

---

## 6. Чего в стеке нет (сознательно)

- **Axios и другие HTTP-клиенты.** Заменены своим `apiFetch` на `fetch`.
- **CSS-in-JS, Bootstrap, другие CSS-фреймворки.** Только Tailwind v4
  + CSS-переменные для тем.
- **Тёмной/светлой темы в классическом виде.** Вместо этого — 4 сезонные
  темы. Все — светлые, отличаются оттенками и акцентом.
- **i18n.** Проект русскоязычный, интернационализация не планируется в MVP.
- **State-менеджера кроме Pinia.** Vuex не нужен, Pinia самодостаточна.
- **Redis.** Коды подтверждения пока в in-memory (`EmailCodeService`).
  В prod надо будет вынести в Redis или БД — в техдолге.
- **Паролей.** Passwordless-вход через email-код.
- **Fastify.** Используем Express, стандартную платформу Nest.