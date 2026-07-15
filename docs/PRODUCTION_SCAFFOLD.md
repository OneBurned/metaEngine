# Production scaffold

Этот документ описывает .NET 10 каркас production-версии MetaEngine.
Node.js local lab остается reference-реализацией формул и продолжает запускаться
через `npm start`.

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

RSI и MDD Mean Reversion зарегистрированы как descriptors. Descriptor содержит:

- стабильный `strategyType`;
- `schemaVersion`;
- параметры и значения по умолчанию;
- признаки оптимизируемых параметров;
- выходные ряды, индикаторы, сигналы и позицию.

Поле `isProductionCalculationAvailable` сейчас равно `false`. Это намеренно:
production-формулы еще не перенесены из Node.js в C# и не прошли golden parity.
API не должен создавать впечатление, что незавершенный движок готов к расчетам.

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

Это пока библиотечное ядро: публичный endpoint, запись calculation run и
выполнение через Worker появятся на следующих этапах.

## API

Локальный запуск production scaffold:

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
POST /api/v1/workspaces/{id}/portfolios/import  импорт canonical CSV
GET /api/v1/workspaces/{id}/portfolios          список всех версий
GET /api/v1/workspaces/{id}/portfolios/{portfolioId}  metadata версии
GET /api/v1/workspaces/{id}/portfolios/{portfolioId}/points  точки с pagination
```

API не применяет migrations автоматически. Это отдельный управляемый шаг перед
запуском новой версии приложения.

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

Сейчас Worker проверяет composition root, загружает каталог стратегий и ожидает
завершения процесса. Очередь и выполнение расчетов появятся на следующих
этапах.

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

`MetaEngine.DomainTests` проверяет shared golden parity базовых метрик,
таймфреймы, пропуски, ограничение warnings и границу полной потери капитала.

`MetaEngine.PostgresIntegrationTests` применяет настоящие migrations, выполняет
bootstrap владельца, CSRF-login, импорт/дедупликацию портфеля и чтение workspace
через API. Локально тест
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

- UI входа и управления участниками workspace;
- восстановление пароля, 2FA/OIDC и rate limiting;
- API workflows для пресетов, стратегий, расчетов и jobs;
- production-расчеты пресетов и модулей RSI/MDD Mean Reversion;
- очередь заданий;
- OpenAPI;
- Plotly contracts;
- production Docker images и CD.

CI уже находится в `.github/workflows/ci.yml`; он проверяет compose, собирает
solution, применяет migrations к PostgreSQL 16, запускает все тесты и NuGet
security audit. Подробности находятся в `docs/PRODUCTION_CI.md`.
