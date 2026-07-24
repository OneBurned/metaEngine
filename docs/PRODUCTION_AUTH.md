# Production authentication

Этот документ описывает первый production-контур входа MetaEngine. Публичной
регистрации нет: первый владелец создается отдельно, а остальные пользователи
позже будут добавляться через управление участниками workspace.


## Development-вход для Codespaces/local проверки

В Docker Compose development-запуске можно не выполнять bootstrap вручную: при
`ASPNETCORE_ENVIRONMENT=Development` и `MetaEngine__DevAuth__Enabled=true` API
принимает логин `admin` и пароль `admin`, сам создает локального администратора
и workspace `Personal`, если их еще нет. Этот режим нужен только для быстрой
проверки PR в Codespaces/local окружении.

В `Production` dev-вход не используется: для настоящего окружения остается
bootstrap первого владельца ниже и полноценная cookie-auth схема.

## Первый владелец

Сначала применить migrations, затем один раз выполнить в корне проекта:

```bash
read -r -p "Admin email: " ADMIN_EMAIL
read -r -s -p "Admin password: " ADMIN_PASSWORD; echo
export MetaEngine__BootstrapAdmin__Email="$ADMIN_EMAIL"
export MetaEngine__BootstrapAdmin__Password="$ADMIN_PASSWORD"
export MetaEngine__BootstrapAdmin__DisplayName="Owner"
export MetaEngine__BootstrapAdmin__WorkspaceName="Personal"
dotnet run --project src/MetaEngine.Api -- --bootstrap-admin
unset MetaEngine__BootstrapAdmin__Email MetaEngine__BootstrapAdmin__Password
```

Пароль должен содержать минимум 12 символов, верхний и нижний регистр, цифру и
специальный символ. Команда создает пользователя, личный workspace и membership
с ролью `Admin` в одной транзакции. Повтор с тем же email безопасен и не меняет
пароль. Создать другого первого владельца после bootstrap нельзя.
При временном сбое PostgreSQL вся транзакция bootstrap безопасно повторяется;
если первый commit уже успел завершиться, повторный вызов возвращает созданного
владельца и его workspace.

Пароль нельзя передавать аргументом командной строки, сохранять в Git, `.env`,
shell history, `appsettings*.json` или container image.

Для уже запущенного Compose-окружения вместо `dotnet run` можно использовать
одноразовый API-контейнер после ввода значений через prompt:

```bash
read -r -p "Admin email: " ADMIN_EMAIL
read -r -s -p "Admin password: " ADMIN_PASSWORD; echo
docker compose run --rm --no-deps \
  -e MetaEngine__BootstrapAdmin__Email="$ADMIN_EMAIL" \
  -e MetaEngine__BootstrapAdmin__Password="$ADMIN_PASSWORD" \
  api --bootstrap-admin
unset ADMIN_EMAIL ADMIN_PASSWORD
```

Для `Production` этот запуск должен использовать тот же приватный Compose
override с PFX-сертификатом, что и основной API; см.
`docs/PRODUCTION_DEPLOYMENT.md`.

## Проверка входа

Запустить API:

```bash
dotnet run --project src/MetaEngine.Api --urls http://0.0.0.0:5080
```

Во втором терминале получить CSRF-токен, войти и проверить сессию:

```bash
read -r -p "Admin email: " ADMIN_EMAIL
read -r -s -p "Admin password: " ADMIN_PASSWORD; echo
CSRF=$(curl -s -c /tmp/metaengine-cookies.txt \
  http://localhost:5080/api/v1/auth/csrf | jq -r .token)
curl -i -b /tmp/metaengine-cookies.txt -c /tmp/metaengine-cookies.txt \
  -H "Content-Type: application/json" \
  -H "X-CSRF-TOKEN: $CSRF" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  http://localhost:5080/api/v1/auth/login
curl -s -b /tmp/metaengine-cookies.txt \
  http://localhost:5080/api/v1/auth/me | jq
unset ADMIN_EMAIL ADMIN_PASSWORD CSRF
rm -f /tmp/metaengine-cookies.txt
```

Login/logout без корректного `X-CSRF-TOKEN` возвращают HTTP `400` с кодом
`invalid_csrf_token`. Неавторизованный workspace-запрос возвращает `401`, а
чужой или несуществующий workspace для авторизованного пользователя — `404`,
чтобы не раскрывать его существование.

## Роли workspace

| Роль | Чтение | Изменение данных | Управление доступом |
| --- | --- | --- | --- |
| `Admin` | да | да | да |
| `Researcher` | да | да | нет |
| `Viewer` | да | нет | нет |

Membership проверяется по user ID из auth-cookie на каждом workspace endpoint.
Отключенный доменный профиль теряет доступ даже при наличии ранее выданной
cookie. После пяти неверных паролей вход блокируется на 15 минут.

## Защита production cookie

Auth-cookie имеет `HttpOnly`, `SameSite=Strict`, `Secure` и имя
`__Host-MetaEngine.Auth`. Ключи ASP.NET Core Data Protection сохраняются в
PostgreSQL, чтобы сессии переживали рестарт и работали между экземплярами API.

В production запуск намеренно завершается ошибкой без PFX-сертификата. Передать
его нужно только через secret storage окружения:

```text
MetaEngine__DataProtection__CertificatePath
MetaEngine__DataProtection__CertificatePassword
```

Файл PFX и пароль нельзя хранить в Git или container image. Сертификат должен
быть доступен всем экземплярам API, а его ротация должна учитывать срок жизни
существующих cookie.

## Что еще не реализовано

- приглашения и управление участниками workspace;
- восстановление и смена пароля;
- 2FA и внешний OIDC-провайдер;
- rate limiting и централизованный security monitoring.
