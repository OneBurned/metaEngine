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
```

API не применяет migrations автоматически. Это отдельный управляемый шаг перед
запуском новой версии приложения.

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
  result artifact `timestamp,diff`.

## PostgreSQL

Первая migration находится в
`src/MetaEngine.Infrastructure/Persistence/Migrations`. Схема хранит
пользователей, workspace membership, версии портфелей и пресетов,
мета-стратегии, calculation runs, optimization jobs/top-N, audit events и
неизменяемые result artifacts.

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

- авторизация и проверка workspace на API endpoint;
- CRUD/API workflows для production-сущностей;
- production calculation engine;
- очередь заданий;
- OpenAPI;
- Plotly contracts;
- Docker images и CI/CD.
