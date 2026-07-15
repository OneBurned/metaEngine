# Production CI

GitHub Actions workflow `.github/workflows/ci.yml` является обязательной
проверкой платформы MetaEngine. Он запускается на каждый push, pull request и
вручную через `workflow_dispatch`. Workflow ничего не деплоит.

## Что проверяет CI

1. Валидность `compose.yml`.
2. Восстановление .NET tools и NuGet packages.
3. NuGet audit; предупреждения `NU1901-NU1904` считаются ошибками.
4. Release build всего `MetaEngine.slnx`.
5. Соответствие EF Core model последней migration.
6. Генерацию idempotent SQL migration script.
7. Применение migrations к чистой PostgreSQL 16 service database.
8. Все .NET contract, API и PostgreSQL integration tests.
9. Все Node.js reference tests.

Workflow использует только тестовые credentials внутри одноразового GitHub
Actions service container. Production secrets в CI для этого workflow не нужны.

## PostgreSQL integration test

Проект `tests/MetaEngine.PostgresIntegrationTests` проверяет полный вертикальный
сценарий на Npgsql/PostgreSQL:

- применение migrations;
- отсутствие pending migrations;
- первый и повторный bootstrap владельца;
- получение CSRF-токена;
- вход через auth-cookie;
- чтение собственного workspace с ролью `Admin`.

Обычный `dotnet test MetaEngine.slnx` на машине без отдельной test database
покажет этот тест как `SKIP`. Это не ошибка. Для ручного запуска сначала поднять
локальную базу, применить migrations и передать только тестовую connection
string:

```bash
cp -n .env.example .env
docker compose up -d postgres
dotnet tool restore
docker compose exec -T postgres createdb -U metaengine metaengine_test
export METAENGINE_TEST_POSTGRES="Host=127.0.0.1;Port=5432;Database=metaengine_test;Username=metaengine;Password=metaengine_dev"
dotnet test tests/MetaEngine.PostgresIntegrationTests/MetaEngine.PostgresIntegrationTests.csproj
unset METAENGINE_TEST_POSTGRES
```

Команда `createdb` нужна один раз; сообщение `database already exists` при
повторном запуске означает, что можно переходить к тесту. Использовать обычную
локальную или production database для integration tests запрещено. Тест
программно принимает только имена баз с суффиксом `_test` или `_ci`, создает
bootstrap account и изменяет переданную базу.

## Правило merge

Перед merge в `main` workflow `CI / Build, test, and migrate` должен завершиться
успешно. После первого успешного запуска этот check следует сделать required в
GitHub branch protection для `main`. Merge и deployment остаются отдельными
действиями и требуют подтверждения пользователя.
