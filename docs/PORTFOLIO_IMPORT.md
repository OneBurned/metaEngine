# Production portfolio import

Этап P2a добавляет первый production workflow данных: авторизованный пользователь
загружает canonical CSV, API нормализует его и сохраняет неизменяемую версию
портфеля в PostgreSQL. Пользовательского production UI для этого workflow пока
нет; Node.js local lab продолжает работать по прежним правилам.

## Формат CSV

Файл должен быть UTF-8 и иметь ровно две колонки с заголовком:

```csv
timestamp,diff
1704499200000,0.01
1704502800000,-0.02
1704506400000,0.03
```

`timestamp` принимается как Unix milliseconds, `YYYY-MM-DD HH:mm`,
`YYYY-MM-DDTHH:mm` или ISO 8601. Время нормализуется в UTC. `diff` — конечное
число в decimal scale: `0.01` означает `1%`. Percent и `accum` input появятся
отдельным расширением; сейчас они не принимаются.

`diff` не может быть меньше `-1` (`-100%`). Ровно `-1` допустимо и означает
полную потерю капитала; дальнейший базовый расчет остается на `accum=-100%`.

Поддерживаемые интервалы: `1m`, `5m`, `15m`, `1h`, `1d`. Строки сортируются по
времени. Повтор timestamp отклоняет весь импорт. Пропуски не заполняются в БД,
но возвращаются как warnings; будущий расчет применит общее правило
`missing diff = 0`.

Лимиты P2a:

- размер файла до `25 MiB`;
- до `250 000` точек;
- до `100` warnings в ответе, полный `gapCount` сохраняется в отчете;
- страница чтения до `5 000` точек.

## Версии и checksum

Новая загрузка без `portfolioKey` создает новый logical portfolio с `version=1`.
Переданный `portfolioKey` создает следующую версию существующего портфеля в том
же workspace. Старые версии не изменяются и не удаляются этим API.

API считает два SHA-256:

- `sourceChecksum` по исходным bytes;
- `seriesChecksum` по отсортированному canonical ряду.

Если любой checksum уже существует в workspace, API возвращает существующую
версию с `created=false`. Новая запись возвращается с `created=true` и HTTP
`201`. Успешное создание записывает `portfolio_imported` в `audit_events`.

## API и доступ

```text
POST /api/v1/workspaces/{workspaceId}/portfolios/import
GET  /api/v1/workspaces/{workspaceId}/portfolios
GET  /api/v1/workspaces/{workspaceId}/portfolios/{portfolioId}
GET  /api/v1/workspaces/{workspaceId}/portfolios/{portfolioId}/points?offset=0&limit=1000
```

`Admin` и `Researcher` могут импортировать. `Viewer` может читать metadata и
points, но получает `403` на импорт. Пользователь без membership получает `404`,
чтобы существование чужого workspace не раскрывалось. POST требует auth-cookie
и свежий CSRF-токен.

После входа по инструкции `docs/PRODUCTION_AUTH.md`:

```bash
WORKSPACE_ID=$(curl -s -b /tmp/metaengine-cookies.txt \
  http://localhost:5080/api/v1/workspaces/ | jq -r '.items[0].id')
CSRF=$(curl -s -b /tmp/metaengine-cookies.txt -c /tmp/metaengine-cookies.txt \
  http://localhost:5080/api/v1/auth/csrf | jq -r .token)
curl -s -b /tmp/metaengine-cookies.txt -c /tmp/metaengine-cookies.txt \
  -H "X-CSRF-TOKEN: $CSRF" \
  -F "name=Primary portfolio" \
  -F "file=@portfolio.csv;type=text/csv" \
  "http://localhost:5080/api/v1/workspaces/$WORKSPACE_ID/portfolios/import" | jq
curl -s -b /tmp/metaengine-cookies.txt \
  "http://localhost:5080/api/v1/workspaces/$WORKSPACE_ID/portfolios" | jq
```

Для новой версии добавить multipart field `portfolioKey` из ответа первой
загрузки. `portfolioId` идентифицирует конкретную неизменяемую версию.

## Еще не реализовано

- production UI загрузки и просмотра;
- import `accum` и явный выбор decimal/percent;
- удаление/архивация портфеля;
- импорт исторических файлов из `samples/portfolios`;
- расчет `accum/hwm/dd/mdd` из сохраненных points.
