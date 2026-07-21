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


## Current strategy result export

The current trading strategy result uses dynamic columns matching the currently calculated strategy table.

For RSI, the export columns are:

```text
timestamp,rsi,signal,execution,weight,in_diff,in_accum,out_diff,out_accum,out_hwm,out_dd,out_mdd
```

For MDD Mean Reversion, the export columns are:

```text
timestamp,in_diff,in_accum,in_dd,local_mdd,signal,execution,active_deals,weight,out_diff,out_accum,out_hwm,out_dd,out_mdd,max_config_weight,max_realized_weight
```

Saved strategy configs are not CSV result series. To export strategy rows, first calculate the strategy and then use the **Экспорт CSV** action in the strategy result block or choose **Текущий результат стратегии** in the CSV export popup when that shared popup is available.
