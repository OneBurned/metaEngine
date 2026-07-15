# Production scaffold

Этот документ описывает первый .NET 10 каркас production-версии MetaEngine.
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
модулей стратегий.

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
dotnet run --project src/MetaEngine.Api --urls http://0.0.0.0:5080
```

Endpoints:

```text
GET /                         информация о сервисе
GET /health/live              процесс API работает
GET /health/ready             каркас готов; зависимости пока отсутствуют
GET /api/v1/strategy-types    descriptors зарегистрированных стратегий
```

После подключения PostgreSQL readiness должен проверять базу и migrations, а не
возвращать готовность без проверки зависимостей.

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
- доступность общих Node.js/C# golden fixtures.

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

- PostgreSQL и migrations;
- пользователи, workspaces и авторизация;
- production calculation engine;
- очередь заданий;
- сохранение результатов;
- OpenAPI;
- Plotly contracts;
- Docker images и CI/CD.
