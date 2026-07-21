# Production platform scaffold and module structure

Этот документ описывает структуру .NET 10 production-платформы MetaEngine.
Node.js local lab остается reference-реализацией формул и продолжает запускаться
через `npm start`; актуальная карта обоих контуров находится в
`docs/ARCHITECTURE.md`.

## Что уже создано

```text
MetaEngine.slnx
src/MetaEngine.Api
src/MetaEngine.Application
src/MetaEngine.Domain
src/MetaEngine.Infrastructure
src/MetaEngine.Worker
src/MetaEngine.Strategies.Abstractions
src/MetaEngine.Strategies.Rsi
src/MetaEngine.Strategies.MddMeanReversion
tests/MetaEngine.ContractTests
tests/MetaEngine.DomainTests
tests/MetaEngine.ApiTests
tests/MetaEngine.PostgresIntegrationTests
```

API и Worker являются отдельными процессами. Оба используют общий каталог
модулей стратегий и общую PostgreSQL persistence infrastructure.

## Статус стратегий

RSI и MDD Mean Reversion являются executable modules. Descriptor содержит:

- стабильный `strategyType`;
- `schemaVersion`;
- параметры и значения по умолчанию;
- признаки оптимизируемых параметров;
- выходные ряды, индикаторы, сигналы и позицию.

Поле `isProductionCalculationAvailable` равно `true`. Оба модуля принимают
канонический result base run и исполняют сделки со следующей точки без
look-ahead. Strategy result сохраняется отдельным immutable artifact.

Общий runtime-контракт `IStrategyModule` предусматривает:

- проверку параметров;
- подготовку исходного ряда;
- потоковую генерацию кандидатов;
- расчет одного кандидата;
- поддержку cancellation token;
- канонический результат `timestamp,diff` и summary.

## Базовое расчетное ядро

`MetaEngine.Domain.Calculations` уже содержит production-реализацию базовых
метрик `diff/accum/hwm/dd/mdd`. Ядро строит исходную сетку периода, применяет
правило `missing diff = 0`, возвращает ограниченный список warnings и умеет
укрупнять результат с `1m/5m/15m/1h/1d` до равного или большего таймфрейма,
включая календарные `1M/1Y` в UTC.

Формулы проверяются тем же `base_metrics.json`, что Node.js reference. Значение
`diff < -100%` отклоняется, а после `diff = -100%` equity остается нулевой без
`NaN` при конвертации таймфрейма. Подробности находятся в
`docs/CALCULATION_ENGINE.md`.

API и Worker уже используют это ядро для immutable base calculation runs.
Публичный запрос только ставит задачу в очередь, а Worker сохраняет canonical
artifact и summary. См. `docs/CALCULATION_RUNS.md`.

## Production presets

В production уже можно сохранять и читать версии пресетов из workspace API.
Строка пресета ссылается на точную версию портфеля, хранит decimal вес и период
`[start, end)`. Суммарный вес не ограничен, но вес не может быть отрицательным;
повтор одного portfolio version допустим только для непересекающихся периодов.
Доменный `PresetCalculationEngine` уже рассчитывает объединенный ряд и
проверяется общим golden fixture. API, Worker и React UI уже позволяют создать
пресет, поставить его в очередь и показать сохраненный результат. Подробности:
`docs/PRESETS.md`.

## API

Локальный запуск production-платформы:

```bash
cp -n .env.example .env
docker compose up -d postgres
dotnet tool restore
dotnet ef database update --project src/MetaEngine.Infrastructure --startup-project src/MetaEngine.Infrastructure
dotnet run --project src/MetaEngine.Api --urls http://0.0.0.0:5080
```

Endpoints:

```text
GET /                         информация о сервисе
GET /health/live              процесс API работает
GET /health/ready             PostgreSQL доступен, migrations применены
GET /api/v1/strategy-types    descriptors зарегистрированных стратегий
GET /api/v1/auth/bootstrap-status  создан ли первый пользователь
GET /api/v1/auth/csrf         CSRF-токен и cookie для login/logout
POST /api/v1/auth/login       вход по email/password
POST /api/v1/auth/logout      завершение сессии
GET /api/v1/auth/me           текущий пользователь и его workspace
GET /api/v1/workspaces/       доступные текущему пользователю workspace
GET /api/v1/workspaces/{id}   workspace только при наличии membership
POST /api/v1/workspaces/{id}/portfolios/import  импорт portfolio CSV accum/diff
GET /api/v1/workspaces/{id}/portfolios          список всех версий
GET /api/v1/workspaces/{id}/portfolios/{portfolioId}  metadata версии
GET /api/v1/workspaces/{id}/portfolios/{portfolioId}/points  точки с pagination
POST /api/v1/workspaces/{id}/presets             создать новую версию пресета
POST /api/v1/workspaces/{id}/presets/{presetId}/delete
POST /api/v1/workspaces/{id}/cleanup/presets/{presetId} удалить неиспользуемую версию пресета
DELETE /api/v1/workspaces/{id}/presets/{presetId} alias для API-клиентов
GET /api/v1/workspaces/{id}/presets              список версий пресетов
GET /api/v1/workspaces/{id}/presets/{presetId}   один пресет с источниками
POST /api/v1/workspaces/{id}/calculation-runs    поставить базовый расчет в очередь
POST /api/v1/workspaces/{id}/calculation-runs/{baseRunId}/strategies  поставить стратегию в очередь
POST /api/v1/workspaces/{id}/calculation-runs/{runId}/retry  повторить failed/interrupted расчет
POST /api/v1/workspaces/{id}/calculation-runs/{runId}/delete?kind=base|strategy
POST /api/v1/workspaces/{id}/cleanup/calculation-runs/{runId}?kind=base|strategy  удалить неактивный неиспользуемый run
POST /api/v1/workspaces/{id}/calculation-runs/delete-many?kind=base|strategy
POST /api/v1/workspaces/{id}/cleanup/calculation-runs?kind=base|strategy      удалить все неактивные неиспользуемые runs указанного типа
DELETE /api/v1/workspaces/{id}/calculation-runs/{runId}?kind=base|strategy        alias для API-клиентов
DELETE /api/v1/workspaces/{id}/calculation-runs?kind=base|strategy                alias для API-клиентов
GET /api/v1/workspaces/{id}/calculation-runs     список расчетов workspace
GET /api/v1/workspaces/{id}/calculation-runs/{runId}  статус, summary и artifact
GET /api/v1/workspaces/{id}/calculation-runs/{runId}/result  paged timestamp,diff
POST /api/v1/workspaces/{id}/strategies          сохранить completed strategy run
POST /api/v1/workspaces/{id}/strategies/{strategyId}/delete
POST /api/v1/workspaces/{id}/cleanup/strategies/{strategyId} удалить неиспользуемую сохраненную стратегию
DELETE /api/v1/workspaces/{id}/strategies/{strategyId} alias для API-клиентов
GET /api/v1/workspaces/{id}/strategies           список сохраненных стратегий
POST /api/v1/workspaces/{id}/calculation-runs/{baseRunId}/optimizations  поставить RSI/MDD optimization
GET /api/v1/workspaces/{id}/optimization-jobs     список optimization jobs
GET /api/v1/workspaces/{id}/optimization-jobs/{jobId}  статус и top-N results
POST /api/v1/workspaces/{id}/optimization-jobs/{jobId}/stop  запросить остановку optimization
POST /api/v1/workspaces/{id}/optimization-jobs/{jobId}/retry  повторить failed/interrupted optimization
POST /api/v1/workspaces/{id}/optimization-jobs/{jobId}/results/{resultId}/strategy-runs  применить candidate
```

`src/MetaEngine.Web` is the production UI over these endpoints. Its Vite
dev server runs on port `3000` and proxies `/api` to this API on `5080`; see
`docs/PRODUCTION_UI.md` for the three-process local workflow.

API не применяет migrations автоматически. Это отдельный управляемый шаг перед
запуском новой версии приложения. Root Docker Compose запускает этот шаг
отдельным контейнером `migrations`; полный сценарий находится в
`docs/PRODUCTION_DEPLOYMENT.md`.

Публичной регистрации нет. Первый владелец создается отдельной командой
`--bootstrap-admin`, после чего повторный запуск с другим email запрещен.
Cookie сессии имеет флаги `HttpOnly` и `SameSite=Strict`; login/logout требуют
CSRF-токен. В production ключи Data Protection защищаются сертификатом.
Настройка и ручная проверка описаны в `docs/PRODUCTION_AUTH.md`.

## Worker

Запуск:

```bash
dotnet run --project src/MetaEngine.Worker
```

Worker проверяет composition root, загружает каталог стратегий и раз в секунду
забирает один queued base/strategy calculation run или optimization job. Для
расчетов он сохраняет summary, warnings и канонический `timestamp,diff`
artifact; для optimization — progress и top-N aggregate results. Детали API,
состояний и ограничений описаны в `docs/CALCULATION_RUNS.md` и
`docs/PRODUCTION_OPTIMIZATION.md`.

Root Compose может поднять несколько одинаковых Worker-контейнеров. Они делят
одну PostgreSQL-очередь безопасно благодаря lease-claim; количество, CPU и
память задаются через `.env`. См. `docs/PRODUCTION_DEPLOYMENT.md`.

## Проверки

```bash
dotnet build MetaEngine.slnx
dotnet test MetaEngine.slnx
npm test
```

.NET contract tests проверяют:

- уникальность `strategyType`;
- стабильный порядок каталога;
- наличие параметров и выходов каждого descriptor;
- отсутствие legacy `baseline/upperLevel/lowerLevel` в RSI descriptor;
- доступность общих Node.js/C# golden fixtures;
- состав production-таблиц, версионность мета-стратегии и канонический формат
  result artifact `timestamp,diff`;
- одноразовый bootstrap первого владельца;
- обязательный CSRF для login;
- cookie-аутентификацию, блокировку отключенного пользователя и workspace
  isolation для ролей `Admin`, `Researcher`, `Viewer`.

`MetaEngine.DomainTests` проверяет shared golden parity базовых метрик и
пресета, таймфреймы, пропуски, ограничение warnings и границу полной потери
капитала.

`MetaEngine.PostgresIntegrationTests` применяет настоящие migrations, выполняет
bootstrap владельца, CSRF-login, импорт/дедупликацию портфеля, сохранение
пресета, базовый расчет и чтение workspace через API. Локально тест
пропускается без отдельной test connection string; в GitHub Actions PostgreSQL
service и переменная окружения обязательны.

## PostgreSQL

Migrations находятся в
`src/MetaEngine.Infrastructure/Persistence/Migrations`. Схема хранит
пользователей, workspace membership, версии портфелей и пресетов,
мета-стратегии, calculation runs, optimization jobs/top-N, audit events и
неизменяемые result artifacts. Учетные данные ASP.NET Core Identity отделены
от доменного профиля пользователя, а ключи Data Protection сохраняются в БД.

Полное описание схемы и безопасной работы с migrations находится в
`docs/PRODUCTION_DATABASE.md`.

## Добавление новой стратегии

На текущем этапе новая стратегия добавляется так:

1. Создать отдельный проект `MetaEngine.Strategies.<Name>`.
2. Добавить ссылку на `MetaEngine.Strategies.Abstractions`.
3. Реализовать descriptor и затем полный `IStrategyModule`.
4. Зарегистрировать модуль в composition root API и Worker.
5. Добавить project reference в solution и contract tests.
6. Добавить golden fixture стратегии.

Общий API, очередь и optimizer engine не должны получать ветвления по типу
стратегии.

## Что еще не реализовано

- UI управления участниками workspace;
- восстановление пароля, 2FA/OIDC и rate limiting;
- production CSV export;
- OpenAPI;
- containerized React UI, TLS/reverse proxy, backups, metrics and production
  release runbook.

CI уже находится в `.github/workflows/ci.yml`; он проверяет compose, собирает
solution, применяет migrations к PostgreSQL 16, запускает все тесты и NuGet
security audit. Подробности находятся в `docs/PRODUCTION_CI.md`.
