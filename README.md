# TradeWise

React + TypeScript + Vite app for importing broker CSVs into Supabase and visualizing performance (dashboard, trades table, calendar).

## Features
- CSV import with broker-aware parsing (Tradovate, TradingView; generic fallback); deduplicates by a stable trade key.
- Direct Tradovate sync through a Supabase Edge Function, so you can pull fills without exporting CSVs.
- Normalizes timestamps, sides, tickers, quantities, PnL; captures commissions/fill prices and raw CSV payload when schema allows.
- Futures PnL adjusts for extra per-contract fees (configurable in the UI).
- Dashboard cards, trades table with pagination, and calendar stats backed by Supabase.

## Getting Started
1) Install dependencies:
```bash
npm install
```
2) Configure Supabase env vars (create `.env.local`):
```bash
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```
3) Run the dev server:
```bash
npm run dev
```
4) Lint:
```bash
npm run lint
```
5) Build / preview:
```bash
npm run build
npm run preview
```

## Tradovate Direct Sync
TradeWise includes a server-side Tradovate sync function at [supabase/functions/tradovate-sync/index.ts](supabase/functions/tradovate-sync/index.ts).

Setup:
1. Deploy the edge function:
```bash
supabase functions deploy tradovate-sync
```
2. Sign in to the app, open Import, choose Tradovate, and use the Direct Sync form.
3. Enter your Tradovate username, password, and environment. Add an API secret only if your Tradovate account requires one.

Notes:
- Credentials are sent to the Supabase Edge Function for the sync request; the app does not persist them.
- The API secret is optional in TradeWise; if Tradovate accepts username/password auth for your account, leave it blank.
- The sync currently imports fills and derives realized PnL using the same FIFO logic used by the CSV importer.
- Commission breakdown is not yet pulled from Tradovate fee records, so synced trades land with `commission = null` for now.
- The function relies on your Supabase project’s default function secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

## Supabase Schema (trades table)
Recommended columns (all lowercase):
- `id` (uuid, primary key, default uuid_generate_v4())  
- `user_id` (uuid)  
- `entry_ts` (timestamptz)  
- `date` (text or date)  
- `time` (text)  
- `side` (text)  
- `type` (text)  
- `ticker` (text)  
- `qty` (numeric)  
- `pnl` (numeric)  
- `change` (text)  
- `source_account` (text)  
- `source_broker` (text)  
- Optional but used when present: `commission` (numeric), `fill_price` (numeric), `raw_payload` (jsonb)

Notes:
- If optional columns are missing, imports will retry without them so data still lands; add the columns for full fidelity and re-import.
- Timestamps are parsed in local time from broker CSVs; dashboard/trades pages display using the viewer’s local timezone.

## Import Tips
- Tradovate: export Account Statements CSV (contains Timestamp/Fill Time). The importer keeps the raw row in `raw_payload` when possible.
- TradingView: use Export in History; closing/placing times are parsed; symbol normalization handles CME_MINI:NQ to `NQ`.
- Extra fees field in the import UI applies per futures contract, per side, and adjusts futures PnL calculation.
- “Import data starting from” filter keeps later trades only.

## Troubleshooting
- Missing column errors (e.g., `commission`, `date`, `raw_payload`): the importer falls back without those fields. Add the columns to Supabase and re-import for complete data.
- Wrong times: confirm the CSV contains local times; importer parses `Timestamp`/`Fill Time`/`Date + Time` as local and stores them. Existing rows with `00:00` need re-import after schema is updated.
- No trades imported: the dedupe key is built from entry_ts/ticker/side/type/qty/pnl/change. If you need to force-import, tweak the CSV or delete existing conflicting rows for that account.
