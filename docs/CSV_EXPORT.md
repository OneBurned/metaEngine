# CSV export

The local lab has a dedicated **Export CSV** block. The button opens a popup styled like the custom date-picker.

## Export sources

The popup supports three sources:

1. saved portfolio;
2. current base calculation result;
3. current trading strategy result.

If the selected current result does not exist yet, the export button is disabled and the popup explains what the user should calculate first.

## Columns

The `timestamp` / date column is always included and cannot be disabled.

The user can independently toggle:

- `diff`;
- `accum`;
- `hwm`;
- `dd`;
- `mdd`.

Any combination is valid, for example:

```text
timestamp,mdd
timestamp,accum
timestamp,diff,hwm
timestamp,diff,accum,hwm,dd,mdd
```

Do not replace this with a fixed dropdown of preset formats.

## Saved portfolio export

Saved portfolios are stored as normalized CSV files:

```csv
timestamp,diff
```

For saved portfolios, the frontend calls the backend with a `columns` query parameter:

```text
GET /api/portfolios/portfolio_a.csv/export?columns=timestamp,mdd
GET /api/portfolios/portfolio_a.csv/export?columns=timestamp,accum,hwm
```

The server recalculates the full portfolio period from saved `timestamp,diff`, derives `accum`, `hwm`, `dd`, and `mdd`, then returns only the requested columns.

## Current result export

For the current base calculation result and current strategy result, CSV is assembled in the browser from already calculated rows.

## Excel compatibility

CSV export keeps the visual data format stable:

- comma `,` remains the column delimiter;
- dot `.` remains the decimal separator;
- numeric values are not wrapped in quotes.

To make Excel detect the file encoding more reliably, exported CSV files start
with a UTF-8 BOM. Text statuses/signals are exported as ASCII values: empty
status-like cells and typographic dashes such as `—` are written as `none`.
This avoids mojibake like `вЂ”` when Excel opens the file with a legacy codepage.

## File names

Downloaded file names should include the source and selected columns, for example:

```text
portfolio_timestamp_mdd.csv
base_result_timestamp_accum.csv
strategy_result_timestamp_diff_accum_mdd.csv
```

## Tests

Export tests should verify:

- the popup exists;
- source selector options exist;
- column toggles exist;
- timestamp/date is always included;
- the client builds selected columns;
- the backend uses `columns` instead of fixed `format` / `exportFormat` presets.
