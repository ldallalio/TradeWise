import type { Trade } from '../data/mockData'

export type TradeRow = Partial<Trade> & {
  date?: string | null
  time?: string | null
  side?: string | null
  type?: string | null
  ticker?: string | null
  qty?: number | string | null
  pnl?: number | string | null
  change?: string | null
  entry_ts?: string | null
  commission?: number | null
  fill_price?: number | null
  raw_payload?: Record<string, unknown> | null
}

const pad = (value: number) => value.toString().padStart(2, '0')

const parseTimeParts = (value?: string | null) => {
  if (!value) return { hours: 0, minutes: 0, seconds: 0 }
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
    seconds: Number(match[3] ?? 0)
  }
}

export const formatLocalDate = (value: Date) =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`

export const formatLocalTime = (value: Date) => `${pad(value.getHours())}:${pad(value.getMinutes())}`

export const parseLocalTradeDate = (dateValue?: string | null, timeValue?: string | null) => {
  if (!dateValue) return null
  const trimmedDate = dateValue.trim()
  if (!trimmedDate) return null

  const isoMatch = trimmedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const timeParts = parseTimeParts(timeValue)
    if (timeValue && !timeParts) return null
    return new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
      timeParts?.hours ?? 0,
      timeParts?.minutes ?? 0,
      timeParts?.seconds ?? 0
    )
  }

  const fallback = new Date(timeValue ? `${trimmedDate} ${timeValue.trim()}` : trimmedDate)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

export const getTradeDate = (trade: Pick<TradeRow, 'entry_ts' | 'date' | 'time'>) => {
  if (trade.entry_ts) {
    const entryDate = new Date(trade.entry_ts)
    if (!Number.isNaN(entryDate.getTime())) return entryDate
  }
  return parseLocalTradeDate(trade.date, trade.time)
}

export const normalizeTradeRow = (row: TradeRow): Trade => {
  const tradeDate = getTradeDate(row)

  return {
    date: row.date ?? (tradeDate ? formatLocalDate(tradeDate) : ''),
    time: row.time ?? (tradeDate ? formatLocalTime(tradeDate) : ''),
    side: row.side ?? '',
    type: row.type ?? '',
    ticker: row.ticker ?? '',
    qty: Number(row.qty) || 0,
    pnl: Number(row.pnl) || 0,
    change: row.change ?? '',
    entry_ts: row.entry_ts ?? null,
    commission: row.commission ?? null,
    fill_price: row.fill_price ?? null,
    raw_payload: row.raw_payload ?? null,
    source_account: row.source_account ?? null,
    source_broker: row.source_broker ?? null
  }
}