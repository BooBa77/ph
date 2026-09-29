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
| Среда исполнения | Node.js | 22 |

---

## 2. Backend (NestJS)

### 2.1 Ядро фреймворка

- **`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`** —
  базовый NestJS. Модульная структура: код разбит на модули
  (`AuthModule`, `UsersModule`, `EmailModule`, `HealthModule` и т.д.),
  внутри каждого — контроллеры (роуты), сервисы (логика), DTO.
  Платформа — **Express**, не Fastify. Все стандартные middleware
  Express-совместимы.
- **`reflect-metadata`, `rxjs`** — транзитивные зависимости NestJS,
  напрямую в коде не используются.

### 2.2 Работа с БД

- **`typeorm` + `@nestjs/typeorm` + `pg`** — ORM для PostgreSQL.
  Сущности проекта: `User`, `AuthIdentity`, `Session`.
  Миграции лежат в `src/migrations/`, запускаются через
  `npm run migration:run`. Подключение к БД описано в
  `src/data-source.ts` и через `TypeOrmModule.forRootAsync()` в `AppModule`.
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
`argon2` в зависимостях лежит по инерции и подлежит удалению (см. техдолг).
Refresh-токены хешируются **SHA-256** — этого достаточно, так как
сам токен уже случайная строка с высокой энтропией.

### 2.4 Валидация и DTO

- **`class-validator` + `class-transformer`** — валидация входных данных
  через глобальный `ValidationPipe` с опциями
  `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
  `whitelist` отрезает поля, которых нет в DTO. `forbidNonWhitelisted`
  бросает 400, если пришло лишнее поле. `transform` превращает plain-объект
  в экземпляр DTO-класса.

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
- **`@nestjs/swagger`** — автогенерация OpenAPI-документации по декораторам
  (`@ApiProperty`, `@ApiOperation`). Доступна по отдельному роуту
  (см. `main.ts`).
- **`nodemailer`** — отправка писем. Используется в `SmtpService`
  внутри `EmailModule`. В dev — заглушка: письмо не уходит,
  а логируется в консоль (`[DEV] Письмо не отправлено...`).
  В prod — реальная отправка через smtp.mail.ru.
- **`ua-parser-js`** — парсинг `User-Agent` в `AuthService` при создании
  `Session`. Из заголовка извлекается `device_label` (браузер, ОС),
  который хранится в сессии. Позже это даст список устройств
  с возможностью отозвать сессию на конкретном.

### 2.7 Свои модули проекта

- **`AuthModule`** — passwordless-вход: `request-code`, `verify-code`,
  `refresh`, `logout`. Внутри — `AuthService`, `AuthController`,
  `JwtStrategy`, `JwtAuthGuard`.
- **`UsersModule`** — работа с пользователями. `UsersService` (CRUD,
  soft delete через `deleted_at`), `UsersController` (роут `/api/users/me`).
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
  `meta.requiresAuth` и `isAuthenticated` из auth-store, редиректит между
  `/` и `/auth`.
- **`pinia@4`** — store. Два store: `useAuthStore` (user, accessToken,
  isBootstrapped, refreshAccessToken, bootstrap) и `useAppStore`
  (isUserBusy — счётчик «юзер занят», для отложенного reload при PWA-обновлении).
  Синтаксис — setup-стиль.

isBootstrapped — флаг «мы уже проверили, залогинен ли юзер при
старте приложения?». Bootstrap делает один запрос POST /api/auth/refresh:
если cookie жива, store получает новый access-токен и user;
если нет — accessToken: null, store остаётся пустым, isBootstrapped = true.
Router-guard вызывает bootstrap один раз на первый переход: до тех пор,
пока isBootstrapped === false, guard ждёт; после — пропускает.
Без этого флага guard дёргал бы refresh на каждом переходе.  

### 3.4 PWA

- **`vite-plugin-pwa`** — генерация service worker и манифеста.
  Стратегия `injectManifest` (свой SW в `src/sw.ts`), `registerType: 'prompt'`
  (без автообновления — рулим вручную). В dev PWA отключена.
- **`workbox-window`** — обёртка для общения с service worker из
  основного потока. Используется в `composables/useSwUpdate.ts`.

### 3.5 HTTP-слой

Своего HTTP-клиента (axios и т.п.) **нет** — используется нативный `fetch`,
обёрнутый в `src/api/client.ts` (`apiFetch`). Обёртка даёт:
автоподстановку `Authorization: Bearer`, `credentials: 'include'`
для refresh-cookie, авто-refresh при 401 (single-flight) и один повтор
запроса, разбор JSON/204, бросание `ApiError` при 4xx/5xx.

Структура `src/api/`:
- `errors.ts` — класс `ApiError` + хелперы разбора тела ошибки.
- `types.ts` — TS-типы (`User`, `UserBrief`, `AuthResponse`, `RefreshResponse`).
- `client.ts` — `apiFetch<T>`, единая точка для защищённых запросов.
- `auth.ts` — `requestCode`, `verifyCode`, `logout` (прямые `fetch`, без `apiFetch`).
- `users.ts` — `getMe()` (в планах).

Когда кидается ApiError, а когда — что-то другое. ApiError — это
ошибка ответа сервера со статусом 4xx или 5xx: бэк прислал JSON
с полем message, обёртка его разобрала и бросила ApiError(status, message, body).
Компонент ловит её и решает, что показать (e instanceof ApiError && e.status === 400).

Если сеть упала (сервер недоступен, DNS не разрешился) или бэк вернул
500 без осмысленного тела — fetch либо отклоняется с TypeError,
либо ApiError содержит message: "HTTP 500". Политика в apiFetch
такая: различать «сервер честно сказал 4xx» и «сервер не ответил / упал».
Первое — вина клиента, второе — вина сети/сервера. Компоненту это
позволяет выбрать разные тексты ошибок и разное поведение (retry / показать
форму входа / показать «попробуйте позже»).

Однонаправленность зависимостей внутри api/ и stores/.
Здесь легко получить циклический импорт, и мы его сознательно разорвали.
Правило простое:

stores/auth.ts не импортирует ничего из api/client.ts
и api/auth.ts (кроме ApiError из errors.ts и типов из types.ts).

api/client.ts импортирует stores/auth.ts — но useAuthStore()
вызывается внутри функции, не на уровне модуля (на момент импорта
client.ts Pinia ещё не инициализирована).

api/auth.ts не импортирует store: requestCode, verifyCode,
logout — прямые fetch, они не кладут данные в store. Это делает
компонент (AuthView.vue зовёт authStore.setAuth(...) после verifyCode).

Смысл: store — про состояние, api/* — про HTTP. Компонент их связывает.
Если бы store сам звал api/client.ts, а тот — обратно store, был бы цикл.
Ручной setAuth из компонента — цена за разрыв цикла, и она того стоит.

### 3.6 Инструменты разработчика

- **`vite-plugin-vue-devtools`** — инспектор Vue/Pinia/Router в браузере.
- **`vue-tsc`** — проверка типов в `.vue`-файлах (Vite сам типы
  не проверяет, только транспилирует).
- **`eslint` + `eslint-plugin-vue` + `@vue/eslint-config-typescript` +
  `eslint-config-prettier`** — линт Vue-специфичных правил и TS.
- **`oxlint` + `eslint-plugin-oxlint`** — второй, быстрый линтер на Rust.
  Работают в паре: `oxlint` ловит очевидное быстро, `eslint` — глубокие правила.
- **`prettier`** — форматирование.
- **`npm-run-all2`** — параллельный запуск скриптов
  (`npm run build` = `type-check` + `build-only`).

---

## 4. Как связаны слои

Запрос от браузера проходит так:
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


Обратно:
- JSON-ответ.
- Если эндпоинт выставляет cookie (verify-code, refresh) —
  `Set-Cookie: refresh_token=...; HttpOnly; SameSite=Lax`.
- Фронт получает JSON через `apiFetch`, кладёт `accessToken` в `Pinia`
  (только в памяти, не в localStorage), `user` — туда же.
- Cookie живёт в браузере, JS её не видит (HttpOnly).
  Отправляется автоматически при `credentials: 'include'` и совпадении origin.

Где что хранится:
| Данные | Где живут | Время жизни |
|---|---|---|
| access-токен | Pinia (память) | 30 минут |
| refresh-токен | httpOnly cookie | 180 дней, ротируется при каждом refresh |
| refresh-хеш | `sessions.refresh_token_hash` (БД) | до отзыва сессии |
| код подтверждения | `EmailCodeService` (in-memory) | 5 минут |
| user | Pinia (после `verify-code` — краткий, `getMe` — полный) | до logout/refresh-fail |

---

## 5. Версии — почему именно такие

- **TypeScript 6, не 7** — `vue-tsc@3.3.7` несовместим с TS 7.
  Как только `vue-tsc` догонит — можно обновляться.
- **Vue 3.5, не 2** — Composition API, `<script setup>`,
  лучшая типизация. Vue 2 в 2026 официально EOL.
- **NestJS 12** — актуальная мажорная версия, всё остальное
  (`@nestjs/jwt`, `@nestjs/passport`, `@nestjs/swagger`) подтянуто под неё.
- **Node 22** — LTS-версия, требование `@tsconfig/node22` и фронта, и бэка.
- **PostgreSQL 16 + PostGIS 3.5** — PostGIS под эту мажорную версию PG.
- **Pinia 4** — setup-синтаксис, работает поверх Vue 3.5.

---

## 6. Чего в стеке нет (сознательно)

- **Axios и другие HTTP-клиенты.** Заменены своим `apiFetch` на `fetch`.
- **CSS-фреймворка** (Tailwind, Bootstrap и т.п.). Пока — scoped-стили
  в `.vue`-компонентах. Если понадобится — обсудим отдельно.
- **i18n.** Проект русскоязычный, интернационализация не планируется в MVP.
- **State-менеджера кроме Pinia.** Vuex не нужен, Pinia самодостаточна.
- **Redis.** Коды подтверждения пока в in-memory (`EmailCodeService`).
  В prod надо будет вынести в Redis или БД — в техдолге.
- **Паролей.** Passwordless-вход через email-код.
- **Fastify.** Используем Express, стандартную платформу Nest.
- **`argon2`** — лежит в зависимостях по ошибке, подлежит удалению.