# CSV export

Production UI has a dedicated **Экспорт** navigation tab that restores the old large export workflow. The user chooses a source, selects any available columns, and downloads CSV. The older local lab still has its popup-style **Export CSV** block.

## Export sources

The export module supports these source groups:

1. saved portfolio versions;
2. completed base calculation results;
3. completed trading strategy results;
4. saved strategy results.

If the selected group has no completed source yet, the module shows an empty state and the download action remains disabled.

## Columns

The `timestamp` and `date` columns are normal selectable columns in production export. They can be used alone with one metric or together with all available columns.

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

For saved portfolios, the production frontend loads the stored `timestamp,diff` points, derives `accum`, `hwm`, `dd`, and `mdd`, then writes only the selected columns into the downloaded file. This keeps the export module flexible while the backend API still exposes canonical points.

## Current result export

For portfolio versions, completed base calculation results, completed strategy results, and saved strategy results, the production UI downloads canonical `timestamp,diff` points from the API, derives `accum`, `hwm`, `dd`, and `mdd`, then assembles CSV in the browser from the selected columns.

## File names

Downloaded file names should include the source and selected columns, for example:

```text
portfolio_timestamp_mdd.csv
base_result_timestamp_accum.csv
strategy_result_timestamp_diff_accum_mdd.csv
```

## Tests

Export tests should verify:

- the dedicated **Экспорт** tab exists;
- source selector options exist;
- column toggles exist;
- timestamp/date can be enabled or disabled like any other column;
- the client builds selected columns;
- the export flow avoids fixed `format` / `exportFormat` presets.


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

Saved strategy configs are not CSV result series. To export strategy rows, first calculate or save the strategy result, then use either the **Экспорт CSV** shortcut in the strategy result block or the dedicated **Экспорт** tab with source type **Сохраненная стратегия** / **Расчет / результат стратегии**.
