import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { supabase } from '../supabaseClient'
import type { CalendarCell, Trade } from '../data/mockData'
import { aggregateStats, formatCurrency } from '../utils/stats'
import { shouldHideFilledZeroPnl } from '../utils/tradeFilters'

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dateLabelFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
})

const parseTradeDate = (trade: Trade) => {
  if (trade.entry_ts) {
    const dt = new Date(trade.entry_ts)
    if (!Number.isNaN(dt.getTime())) return dt
  }
  if (trade.date) {
    const timePart = trade.time ? (trade.time.length === 5 ? `${trade.time}:00` : trade.time) : '00:00:00'
    const iso = `${trade.date}T${timePart}`
    const dt = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
    if (!Number.isNaN(dt.getTime())) return dt
  }
  return null
}

type MonthOption = { month: number; year: number; label: string }
type CalendarCellWithTrades = CalendarCell & { trades?: Trade[]; fullDate?: Date }

const buildCalendarRows = (month: MonthOption | undefined, trades: Trade[]): CalendarCellWithTrades[][] => {
  if (!month) return []
  const daily = new Map<
    number,
    {
      value: number
      wins: number
      losses: number
      trades: Trade[]
    }
  >()
  trades.forEach((trade) => {
    if (shouldHideFilledZeroPnl(trade)) return
    const dt = parseTradeDate(trade)
    if (!dt) return
    const day = dt.getUTCDate()
    const bucket = daily.get(day) ?? { value: 0, wins: 0, losses: 0, trades: [] }
    bucket.value += trade.pnl
    if (trade.pnl > 0) {
      bucket.wins += 1
    } else if (trade.pnl < 0) {
      bucket.losses += 1
    }
    bucket.trades.push(trade)
    daily.set(day, bucket)
  })
  const firstOfMonth = new Date(Date.UTC(month.year, month.month, 1))
  const daysInMonth = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate()
  const startingOffset = (firstOfMonth.getUTCDay() + 6) % 7 // convert Sunday=0 to Monday=0
  const rows: CalendarCellWithTrades[][] = []
  let buffer: CalendarCellWithTrades[] = []
  for (let i = 0; i < startingOffset; i += 1) {
    buffer.push({ day: '' })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const summary = daily.get(day)
    const fullDate = new Date(Date.UTC(month.year, month.month, day))
    buffer.push({
      day: day.toString().padStart(2, '0'),
      value: summary?.value,
      wins: summary?.wins,
      losses: summary?.losses,
      trades: summary?.trades,
      fullDate: summary ? fullDate : undefined
    })
    if (buffer.length === 7) {
      rows.push(buffer)
      buffer = []
    }
  }
  if (buffer.length) {
    while (buffer.length < 7) {
      buffer.push({ day: '' })
    }
    rows.push(buffer)
  }
  return rows
}

type Props = {
  userId?: string
  selectedAccounts?: string[] | null
}

export function CalendarPage({ userId, selectedAccounts = null }: Props) {
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [monthCursor, setMonthCursor] = useState(0)
  const [hoverInfo, setHoverInfo] = useState<{
    label: string
    trades: Trade[]
    position: { top: number; left: number }
  } | null>(null)
  const tooltipTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const fetchTrades = async () => {
      if (selectedAccounts !== null && !selectedAccounts.length) {
        setTrades([])
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      let query = supabase.from('trades').select('*').order('entry_ts', { ascending: true })
      if (userId) {
        query = query.eq('user_id', userId)
      }
      if (selectedAccounts && selectedAccounts.length) {
        query = query.in('source_account', selectedAccounts)
      }
      const { data, error: supaError } = await query
      if (supaError) {
        setError('Unable to load calendar stats.')
        setTrades([])
        setLoading(false)
        return
      }
      const normalized: Trade[] =
        data?.map((t: any) => ({
          date: t.date ?? (t.entry_ts ? new Date(t.entry_ts).toISOString().slice(0, 10) : ''),
          time: t.time ?? (t.entry_ts ? new Date(t.entry_ts).toISOString().slice(11, 16) : ''),
          side: t.side ?? '',
          type: t.type ?? '',
          ticker: t.ticker ?? '',
          qty: Number(t.qty) || 0,
          pnl: Number(t.pnl) || 0,
          change: t.change ?? '',
          entry_ts: t.entry_ts ?? null
        })) ?? []
      setTrades(normalized)
      setLoading(false)
    }
    fetchTrades()
  }, [userId, selectedAccounts])

  const monthOptions = useMemo<MonthOption[]>(() => {
    const monthMap = new Map<string, MonthOption>()
    trades.forEach((trade) => {
      const dt = parseTradeDate(trade)
      if (!dt) return
      const month = dt.getUTCMonth()
      const year = dt.getUTCFullYear()
      const key = `${year}-${month}`
      if (!monthMap.has(key)) {
        monthMap.set(key, {
          month,
          year,
          label: monthFormatter.format(new Date(Date.UTC(year, month, 1)))
        })
      }
    })
    return Array.from(monthMap.values()).sort((a, b) => {
      if (a.year === b.year) return b.month - a.month
      return b.year - a.year
    })
  }, [trades])

  const fallbackMonth = useMemo<MonthOption>(() => {
    const now = new Date()
    const month = now.getUTCMonth()
    const year = now.getUTCFullYear()
    return { month, year, label: monthFormatter.format(new Date(Date.UTC(year, month, 1))) }
  }, [])

  const months = monthOptions.length ? monthOptions : [fallbackMonth]

  useEffect(() => {
    setMonthCursor((idx) => Math.min(idx, months.length - 1))
  }, [months.length])

  const safeCursor = Math.min(monthCursor, months.length - 1)
  const activeMonth = months[safeCursor]
  useEffect(() => {
    setHoverInfo(null)
    if (tooltipTimeoutRef.current) {
      window.clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
  }, [activeMonth])
  useEffect(
    () => () => {
      if (tooltipTimeoutRef.current) {
        window.clearTimeout(tooltipTimeoutRef.current)
      }
    },
    []
  )

  const monthTrades = useMemo(() => {
    if (!activeMonth) return []
    const startMs = Date.UTC(activeMonth.year, activeMonth.month, 1)
    const endMs = Date.UTC(activeMonth.year, activeMonth.month + 1, 1)
    return trades.filter((trade) => {
      const dt = parseTradeDate(trade)
      if (!dt) return false
      const ts = dt.getTime()
      return ts >= startMs && ts < endMs
    })
  }, [activeMonth, trades])

  const monthStats = useMemo(() => aggregateStats(monthTrades), [monthTrades])
  const averageReturn = Math.round(monthStats.averageReturn * 100) / 100
  const calendarRows = useMemo<CalendarCellWithTrades[][]>(
    () => buildCalendarRows(activeMonth, monthTrades),
    [activeMonth, monthTrades]
  )
  const tradesLabel = monthTrades.length ? `${monthTrades.length} trades` : 'No trades this month'
  const canGoPrev = safeCursor < months.length - 1
  const canGoNext = safeCursor > 0

  const clearHideTimeout = () => {
    if (tooltipTimeoutRef.current) {
      window.clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
  }

  const scheduleHide = () => {
    clearHideTimeout()
    tooltipTimeoutRef.current = window.setTimeout(() => {
      setHoverInfo(null)
      tooltipTimeoutRef.current = null
    }, 130)
  }

  const handleCellEnter = (event: MouseEvent<HTMLDivElement>, cell: CalendarCellWithTrades) => {
    if (!cell.trades?.length) return
    clearHideTimeout()
    const rect = event.currentTarget.getBoundingClientRect()
    const tooltipWidth = 260
    const tooltipHeight = 220
    const label =
      cell.fullDate && !Number.isNaN(cell.fullDate.getTime())
        ? dateLabelFormatter.format(cell.fullDate)
        : `${activeMonth?.label ?? ''} ${cell.day}`
    const desiredLeft = rect.left + window.scrollX + rect.width + 8
    const maxLeft = window.scrollX + window.innerWidth - tooltipWidth - 12
    const left = Math.max(window.scrollX + 12, Math.min(desiredLeft, maxLeft))
    const desiredTop = rect.top + window.scrollY + rect.height / 2 - tooltipHeight / 2
    const maxTop = window.scrollY + window.innerHeight - tooltipHeight - 12
    const top = Math.max(window.scrollY + 12, Math.min(desiredTop, maxTop))
    setHoverInfo({
      label,
      trades: cell.trades,
      position: {
        top,
        left
      }
    })
  }

  const handleCellLeave = () => {
    scheduleHide()
  }

  return (
    <>
      <PageHeader title="Calendar" subtitle="Track performance by day" />

      <section className="panel calendar">
        <div className="calendar-top">
          <div>
            <h2>Stats</h2>
            <div className="muted tiny">{tradesLabel}</div>
          </div>
          <div className="chip-row">
            <span className="chip">{activeMonth?.year ?? '—'}</span>
          </div>
        </div>

        <div className="stat-grid compact">
          <div className="stat-card">
            <div>Total Return</div>
            <div className={`stat-value ${monthStats.cumulativeReturn >= 0 ? 'positive' : 'danger'}`}>
              {formatCurrency(monthStats.cumulativeReturn)}
            </div>
          </div>
          <div className="stat-card">
            <div>Profit Factor</div>
            <div className="stat-value">{monthStats.profitFactor.toFixed(2)}</div>
          </div>
          <div className="stat-card">
            <div>Average Return</div>
            <div className={`stat-value ${averageReturn >= 0 ? 'positive' : 'danger'}`}>
              {formatCurrency(averageReturn)}
            </div>
          </div>
          <div className="stat-card">
            <div>Win Rate</div>
            <div className="stat-value">{monthStats.winRate.toFixed(1)}%</div>
          </div>
        </div>

        <div className="calendar-controls">
          <div className="chip-row">
            <button className="circle-btn" type="button" onClick={() => setMonthCursor((idx) => Math.min(idx + 1, months.length - 1))} disabled={!canGoPrev}>
              ‹
            </button>
            <span className="chip">{activeMonth?.label ?? '—'}</span>
            <button className="circle-btn" type="button" onClick={() => setMonthCursor((idx) => Math.max(idx - 1, 0))} disabled={!canGoNext}>
              ›
            </button>
          </div>
        </div>

        <div className="calendar-grid">
          <div className="calendar-head">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          {calendarRows.map((row, rowIdx) => (
            <div key={rowIdx} className="calendar-row">
              {row.map((cell, cellIdx) => (
                <div
                  key={`${rowIdx}-${cellIdx}`}
                  className={`calendar-cell ${cell.trades?.length ? 'hoverable' : ''}`}
                  onMouseEnter={(event) => handleCellEnter(event, cell)}
                  onMouseLeave={handleCellLeave}
                >
                  <div className="cell-day">{cell.day}</div>
                  {cell.value !== undefined && (
                    <div className={`cell-value ${cell.value >= 0 ? 'success' : 'danger'}`}>
                      {cell.value >= 0 ? '+' : ''}
                      {cell.value.toLocaleString()}
                    </div>
                  )}
                  {cell.wins !== undefined && (
                    <div className="cell-meta">
                      {cell.wins}W {cell.losses ?? 0}L
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        {error && <div className="muted">Error: {error}</div>}
        {loading && <div className="muted">Loading calendar...</div>}
        {!loading && !monthTrades.length && <div className="muted tiny">No trades recorded for this month yet.</div>}
        {hoverInfo && (
          <div
            className="calendar-tooltip"
            style={{ top: hoverInfo.position.top, left: hoverInfo.position.left }}
            onMouseEnter={clearHideTimeout}
            onMouseLeave={scheduleHide}
          >
            <div className="tooltip-header">{hoverInfo.label}</div>
            <div className="tooltip-table">
              <div className="tooltip-row head">
                <span>Ticker</span>
                <span>PnL</span>
              </div>
              {hoverInfo.trades.map((trade, idx) => (
                <div key={`${trade.ticker}-${trade.time}-${idx}`} className="tooltip-row">
                  <span className="muted">{trade.ticker || '—'}</span>
                  <span className={trade.pnl >= 0 ? 'success' : 'danger'}>
                    {trade.pnl >= 0 ? '+' : ''}
                    {'$'}
                    {Math.abs(trade.pnl).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  )
}
