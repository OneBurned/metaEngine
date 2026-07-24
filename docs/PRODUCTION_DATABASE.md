# Production database

Этот документ описывает PostgreSQL persistence foundation MetaEngine. Этапы
P1b-P1c добавили доменную схему, ASP.NET Core Identity и workspace isolation,
но основные production API workflows и расчетный движок еще не реализованы.

## Локальный запуск

В корне проекта:

```bash
cp -n .env.example .env
docker compose up -d postgres
dotnet tool restore
dotnet ef database update --project src/MetaEngine.Infrastructure --startup-project src/MetaEngine.Infrastructure
dotnet run --project src/MetaEngine.Api --urls http://0.0.0.0:5080
```

Локальный и CI baseline — PostgreSQL `16-alpine`. Major version закреплена,
чтобы локальная volume layout и CI service использовали одинаковую схему
запуска; patch-обновления образа остаются доступными внутри ветки 16.

Локальные значения из `.env.example` предназначены только для разработки.
Production connection string передается секретом окружения:

```text
ConnectionStrings__MetaEngine
```

Пароль production-базы нельзя добавлять в Git, `.env`, `appsettings*.json` или
container image.

Остановка без удаления данных:

```bash
docker compose down
```

`docker compose down -v` удаляет volume и все данные локальной базы. Эту команду
можно использовать только когда потеря локальных данных точно допустима.

## Readiness

Endpoints выполняют разные задачи:

```text
GET /health/live   API-процесс работает; база не проверяется
GET /health/ready  PostgreSQL доступен и нет непримененных migrations
```

Если база недоступна или migration не применена, `/health/ready` возвращает
HTTP `503` и `status = not_ready`. В ответ не попадают connection string,
внутреннее исключение или stack trace.

## Схема P1b-P1c

| Таблица | Что хранится |
| --- | --- |
| `users` | Доменный профиль пользователя и статус доступа |
| `user_credentials` | ASP.NET Core Identity: email, hash пароля, lockout и security stamp |
| `user_claims`, `user_logins`, `user_tokens` | Расширения Identity для claims, внешних входов и токенов |
| `data_protection_keys` | Ключи для защиты auth-cookie между рестартами и экземплярами API |
| `workspaces` | Граница владения данными |
| `workspace_members` | Роль пользователя в workspace |
| `portfolios` | Неизменяемая версия метаданных, raw/series checksum и источник портфеля |
| `portfolio_points` | Нормализованный исходный ряд `timestamp,diff` |
| `presets` | Неизменяемая версия пресета |
| `preset_items` | Конкретная версия портфеля или сохраненной мета-стратегии |
| `strategies` | Версия параметров мета-стратегии и ссылка на готовый result artifact |
| `calculation_runs` | Состояние, вход, период, версия движка и summary расчета |
| `optimization_jobs` | Состояние, progress, seed и search space оптимизации |
| `optimization_results` | Только top-N метрик и параметров без полных рядов кандидатов |
| `run_artifacts` | Метаданные неизменяемого результата и checksum |
| `run_artifact_points` | Канонический `timestamp,diff` и optional `fields_json` для строк стратегии |
| `audit_events` | Изменения доступа и действия с данными/jobs |

`accum`, `hwm`, `dd` и `mdd` не являются источником истины. Они строятся из
`diff`; позднее их можно кэшировать без изменения канонического результата.

Для `portfolios` уникальны `(workspace_id, source_checksum)` и
`(workspace_id, series_checksum)`. Поэтому повтор одного файла или того же
нормализованного ряда не создает новую запись. Новая версия имеет тот же
`portfolio_key`, увеличенный `version` и новый checksum. Полный контракт описан
в `docs/PORTFOLIO_IMPORT.md`.

Доменный профиль `users` не зависит от ASP.NET Core Identity. Таблица
`user_credentials` имеет тот же первичный ключ и one-to-one FK на `users`.
Это сохраняет чистую доменную модель и позволяет в будущем заменить способ
входа без изменения владельцев данных. В production XML-ключи Data Protection
дополнительно шифруются PFX-сертификатом; одних прав доступа к БД недостаточно
для расшифровки auth-cookie.

## Версии и пресеты

Портфель, пресет и мета-стратегия имеют стабильный logical key и номер версии.
Обновление создает новую строку, а старую не переписывает.

В P5b workspace API сохраняет portfolio или saved-strategy sources пресета. Каждая строка
указывает на конкретный `portfolios.id`, поэтому новый импорт той же логической
серии не меняет исторический пресет. Вес хранится в decimal (`0.25 = 25%`),
неотрицателен, а сумма весов не ограничена. Период имеет вид `[starts_at,
ends_at)` и может быть открытым; периоды одной и той же portfolio version не
пересекаются. Контракт API и расчета находится в `docs/PRESETS.md`.

P3 использует `calculation_runs`, `run_artifacts` и `run_artifact_points`. Завершенный artifact содержит `timestamp,diff`, SHA-256 checksum и, для стратегий, optional `fields_json` с данными таблицы результата; summary и warnings хранятся в run.
Подробный workflow: `docs/CALCULATION_RUNS.md`.

После выбора результата оптимизации полный расчет создает `run_artifact` и его
`run_artifact_points`. Сохраненная мета-стратегия ссылается на этот artifact.
Элемент пресета ссылается на конкретную версию сохраненной мета-стратегии.
Поэтому последующие обновления источника не меняют исторический пресет.

## Работа с migrations

Восстановить локальный инструмент:

```bash
dotnet tool restore
```

Проверить, что модель соответствует последней migration:

```bash
dotnet ef migrations has-pending-model-changes --project src/MetaEngine.Infrastructure --startup-project src/MetaEngine.Infrastructure
```

Создать migration после согласованного изменения модели:

```bash
dotnet ef migrations add MeaningfulMigrationName --project src/MetaEngine.Infrastructure --startup-project src/MetaEngine.Infrastructure --output-dir Persistence/Migrations
```

Если migration правится вручную, класс должен иметь атрибут
`[Migration("<timestamp>_<Name>")]`; иначе EF Core может не увидеть migration,
и контейнер `migrations` посчитает базу актуальной. Для repair-migration
допустим idempotent SQL (`IF EXISTS` / `IF NOT EXISTS`), чтобы существующие
локальные Codespaces-базы обновлялись без удаления volume и потери загруженных
данных.

Применить локально:

```bash
dotnet ef database update --project src/MetaEngine.Infrastructure --startup-project src/MetaEngine.Infrastructure
```

В staging/production migration не применяется автоматически при старте API.
Перед релизом создается и проверяется idempotent SQL script:

```bash
dotnet ef migrations script --idempotent --project src/MetaEngine.Infrastructure --startup-project src/MetaEngine.Infrastructure
```

### Быстрый ремонт локального Codespaces volume

Если после обновления PR в Codespaces API/Worker падает из-за отсутствующей
колонки в PostgreSQL, не удаляй volume сразу: сначала принудительно перезапусти
одноразовый migrations-контейнер и затем API/Worker:

```bash
docker compose stop api worker
docker compose up --build --force-recreate migrations
docker compose up -d --build api worker
```

Если локальная база уже drifted и ошибка всё равно указывает на отсутствующие
`calculation_runs.error_message` или `run_artifact_points.fields_json`, эти две
команды безопасно добавляют недостающие колонки без удаления загруженных данных:

```bash
docker compose exec -T postgres psql -U metaengine -d metaengine -c 'ALTER TABLE calculation_runs ADD COLUMN IF NOT EXISTS error_message character varying(1000);'
docker compose exec -T postgres psql -U metaengine -d metaengine -c "ALTER TABLE run_artifact_points ADD COLUMN IF NOT EXISTS fields_json jsonb NOT NULL DEFAULT '{}';"
docker compose restart api worker
```

## Следующие шаги

- добавить управление участниками, восстановление пароля, 2FA/OIDC и rate limiting;
- расширять real-PostgreSQL integration tests вместе с новыми API workflows;
- определить retention и backup/restore policy.
