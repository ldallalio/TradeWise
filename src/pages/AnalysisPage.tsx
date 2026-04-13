import { useEffect, useMemo, useState } from 'react'
import type { Trade } from '../data/mockData'
import { PageHeader } from '../components/PageHeader'
import { supabase } from '../supabaseClient'
import { getTradeDate, normalizeTradeRow, type TradeRow } from '../utils/trades'
import type { AnalysisTimeframe } from '../utils/tradeAnalysis'

type Props = {
  trades: Trade[]
  userId?: string
  selectedAccounts?: string[] | null
  defaultView?: 'overview' | 'insights'
}

type Point = {
  label: string
  value: number
}

type SymbolSummary = {
  ticker: string
  count: number
  pnl: number
  winRate: number
  expectancy: number
}

type OverviewStats = {
  filteredTrades: Trade[]
  tradeCount: number
  contracts: number
  grossPnl: number
  fees: number
  netAfterFees: number
  winCount: number
  lossCount: number
  winRate: number
  totalProfit: number
  totalLoss: number
  avgWin: number
  avgLoss: number
  avgTradeDurationSec: number | null
  longestTradeDurationSec: number | null
  avgWinningDurationSec: number | null
  longestWinningDurationSec: number | null
  avgLosingDurationSec: number | null
  longestLosingDurationSec: number | null
  largestWin: number
  largestLoss: number
  expectancy: number
  longCount: number
  shortCount: number
  longPnl: number
  shortPnl: number
  pnlStdDev: number
  pnlHistory: Point[]
  cumulativeNoFees: Point[]
  cumulativeWithFees: Point[]
  pnlDistribution: Point[]
  timeOfDay: Point[]
  symbolRows: SymbolSummary[]
  topSymbol: SymbolSummary | null
  weakestSymbol: SymbolSummary | null
  feesVsLosses: { fees: number; losses: number }
  timeframeLabel: string
}

const formatMoney = (value: number) =>
  `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`

const formatPercent = (value: number) => `${value.toFixed(1)}%`

const formatDuration = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) return 'N/A'
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const sec = total % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m ${sec}s`
  }
  return `${minutes}m ${sec}s`
}

const getTradeDurationSec = (trade: Trade) => {
  const payload = trade.raw_payload as Record<string, unknown> | null | undefined
  const openedAt = typeof payload?._matched_open_ts === 'string' ? payload._matched_open_ts : null
  if (!openedAt) return null
  const closeDate = getTradeDate(trade)
  const openDate = new Date(openedAt)
  if (!closeDate || Number.isNaN(openDate.getTime())) return null
  const diffSec = (closeDate.getTime() - openDate.getTime()) / 1000
  return diffSec > 0 ? diffSec : null
}

const timeframeToDays: Record<AnalysisTimeframe, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  yearly: 365
}

const timeframeToLabel: Record<AnalysisTimeframe, string> = {
  daily: 'Last 1 Day',
  weekly: 'Last 7 Days',
  monthly: 'Last 30 Days',
  yearly: 'Last 365 Days'
}

const getFilteredTrades = (trades: Trade[], timeframe: AnalysisTimeframe) => {
  const withDates = trades
    .map((trade) => ({ trade, dt: getTradeDate(trade) }))
    .filter((row): row is { trade: Trade; dt: Date } => Boolean(row.dt))

  if (!withDates.length) return []

  const anchor = withDates.reduce((latest, row) => (row.dt > latest ? row.dt : latest), withDates[0].dt)
  const cutoff = new Date(anchor)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (timeframeToDays[timeframe] - 1))

  return withDates
    .filter((row) => row.dt >= cutoff)
    .sort((left, right) => left.dt.getTime() - right.dt.getTime())
    .map((row) => row.trade)
}

const standardDeviation = (values: number[]) => {
  if (!values.length) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

const buildDistribution = (values: number[]) => {
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const bucketCount = 8
  if (min === max) {
    return [{ label: `${formatMoney(min)}`, value: values.length }]
  }
  const width = (max - min) / bucketCount
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = min + width * index
    const end = start + width
    return {
      label: `${Math.round(start)}/${Math.round(end)}`,
      value: 0
    }
  })

  values.forEach((value) => {
    const raw = Math.floor((value - min) / width)
    const idx = Math.min(bucketCount - 1, Math.max(0, raw))
    buckets[idx].value += 1
  })

  return buckets
}

const buildOverviewStats = (allTrades: Trade[], timeframe: AnalysisTimeframe): OverviewStats => {
  const filteredTrades = getFilteredTrades(allTrades, timeframe)
  const pnlValues = filteredTrades.map((trade) => Number(trade.pnl) || 0)
  const commissions = filteredTrades.map((trade) => Number(trade.commission) || 0)
  const quantities = filteredTrades.map((trade) => Math.abs(Number(trade.qty) || 0))

  const tradeCount = filteredTrades.length
  const contracts = quantities.reduce((sum, value) => sum + value, 0)
  const grossPnl = pnlValues.reduce((sum, value) => sum + value, 0)
  const fees = commissions.reduce((sum, value) => sum + value, 0)
  const netAfterFees = grossPnl - fees

  const wins = pnlValues.filter((value) => value > 0)
  const losses = pnlValues.filter((value) => value < 0)
  const winCount = wins.length
  const lossCount = losses.length
  const totalProfit = wins.reduce((sum, value) => sum + value, 0)
  const totalLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0))
  const avgWin = winCount ? totalProfit / winCount : 0
  const avgLoss = lossCount ? losses.reduce((sum, value) => sum + value, 0) / lossCount : 0
  const largestWin = winCount ? Math.max(...wins) : 0
  const largestLoss = lossCount ? Math.min(...losses) : 0
  const winRate = tradeCount ? (winCount / tradeCount) * 100 : 0
  const expectancy = tradeCount ? grossPnl / tradeCount : 0

  const durationRows = filteredTrades
    .map((trade) => ({ duration: getTradeDurationSec(trade), pnl: Number(trade.pnl) || 0 }))
    .filter((row): row is { duration: number; pnl: number } => row.duration !== null)
  const allDurations = durationRows.map((row) => row.duration)
  const winDurations = durationRows.filter((row) => row.pnl > 0).map((row) => row.duration)
  const lossDurations = durationRows.filter((row) => row.pnl < 0).map((row) => row.duration)

  let runningNoFees = 0
  let runningWithFees = 0
  const pnlHistory: Point[] = []
  const cumulativeNoFees: Point[] = []
  const cumulativeWithFees: Point[] = []

  filteredTrades.forEach((trade, index) => {
    const pnl = Number(trade.pnl) || 0
    const fee = Number(trade.commission) || 0
    const label = `${index + 1}`
    runningNoFees += pnl
    runningWithFees += pnl - fee
    pnlHistory.push({ label, value: pnl })
    cumulativeNoFees.push({ label, value: runningNoFees })
    cumulativeWithFees.push({ label, value: runningWithFees })
  })

  const symbolMap = new Map<string, { pnl: number; count: number; wins: number }>()
  let longCount = 0
  let shortCount = 0
  let longPnl = 0
  let shortPnl = 0

  const timeBuckets = [
    { label: '00-04', start: 0, end: 4 },
    { label: '05-08', start: 5, end: 8 },
    { label: '09-12', start: 9, end: 12 },
    { label: '13-16', start: 13, end: 16 },
    { label: '17-20', start: 17, end: 20 },
    { label: '21-23', start: 21, end: 23 }
  ].map((bucket) => ({ ...bucket, pnl: 0 }))

  filteredTrades.forEach((trade) => {
    const ticker = (trade.ticker || 'Unknown').toUpperCase()
    const pnl = Number(trade.pnl) || 0
    const entry = symbolMap.get(ticker) ?? { pnl: 0, count: 0, wins: 0 }
    entry.pnl += pnl
    entry.count += 1
    if (pnl > 0) entry.wins += 1
    symbolMap.set(ticker, entry)

    const side = (trade.side || '').toLowerCase()
    if (side === 'long' || side === 'buy') {
      longCount += 1
      longPnl += pnl
    }
    if (side === 'short' || side === 'sell') {
      shortCount += 1
      shortPnl += pnl
    }

    const dt = getTradeDate(trade)
    if (!dt) return
    const hour = dt.getHours()
    const bucket = timeBuckets.find((item) => hour >= item.start && hour <= item.end)
    if (bucket) bucket.pnl += pnl
  })

  const symbolRows: SymbolSummary[] = Array.from(symbolMap.entries())
    .map(([ticker, row]) => ({
      ticker,
      count: row.count,
      pnl: row.pnl,
      winRate: row.count ? (row.wins / row.count) * 100 : 0,
      expectancy: row.count ? row.pnl / row.count : 0
    }))
    .sort((left, right) => right.pnl - left.pnl)

  const topSymbol = symbolRows[0] ?? null
  const weakestSymbol = symbolRows.length ? symbolRows[symbolRows.length - 1] : null

  return {
    filteredTrades,
    tradeCount,
    contracts,
    grossPnl,
    fees,
    netAfterFees,
    winCount,
    lossCount,
    winRate,
    totalProfit,
    totalLoss,
    avgWin,
    avgLoss,
    avgTradeDurationSec: allDurations.length ? allDurations.reduce((sum, value) => sum + value, 0) / allDurations.length : null,
    longestTradeDurationSec: allDurations.length ? Math.max(...allDurations) : null,
    avgWinningDurationSec: winDurations.length ? winDurations.reduce((sum, value) => sum + value, 0) / winDurations.length : null,
    longestWinningDurationSec: winDurations.length ? Math.max(...winDurations) : null,
    avgLosingDurationSec: lossDurations.length ? lossDurations.reduce((sum, value) => sum + value, 0) / lossDurations.length : null,
    longestLosingDurationSec: lossDurations.length ? Math.max(...lossDurations) : null,
    largestWin,
    largestLoss,
    expectancy,
    longCount,
    shortCount,
    longPnl,
    shortPnl,
    pnlStdDev: standardDeviation(pnlValues),
    pnlHistory,
    cumulativeNoFees,
    cumulativeWithFees,
    pnlDistribution: buildDistribution(pnlValues),
    timeOfDay: timeBuckets.map((bucket) => ({ label: bucket.label, value: bucket.pnl })),
    symbolRows,
    topSymbol,
    weakestSymbol,
    feesVsLosses: { fees, losses: totalLoss },
    timeframeLabel: timeframeToLabel[timeframe]
  }
}

const BarChart = ({ points, positiveNegative = false }: { points: Point[]; positiveNegative?: boolean }) => {
  const maxAbs = Math.max(1, ...points.map((point) => Math.abs(point.value)))
  return (
    <div className="analysis-bars">
      {points.map((point) => {
        const height = Math.max(8, (Math.abs(point.value) / maxAbs) * 120)
        const negative = point.value < 0
        return (
          <div key={`${point.label}-${point.value}`} className="analysis-bar-col">
            <span className={`analysis-bar-value ${negative ? 'danger' : 'success'}`}>{formatMoney(point.value)}</span>
            <div
              className={`analysis-bar-fill ${positiveNegative && negative ? 'negative' : 'positive'}`}
              style={{ height: `${height}px` }}
              title={`${point.label}: ${formatMoney(point.value)}`}
            />
            <span className="analysis-bar-label">{point.label}</span>
          </div>
        )
      })}
    </div>
  )
}

const PieCard = ({
  title,
  firstLabel,
  firstValue,
  secondLabel,
  secondValue,
  firstColor,
  secondColor
}: {
  title: string
  firstLabel: string
  firstValue: number
  secondLabel: string
  secondValue: number
  firstColor: string
  secondColor: string
}) => {
  const total = firstValue + secondValue
  const firstPercent = total ? (firstValue / total) * 100 : 0
  const secondPercent = 100 - firstPercent
  return (
    <section className="panel analysis-chart-card">
      <div className="panel-title">{title}</div>
      <div className="analysis-pie-wrap">
        <div
          className="analysis-pie"
          style={{
            background: `conic-gradient(${firstColor} 0 ${firstPercent}%, ${secondColor} ${firstPercent}% 100%)`
          }}
        />
        <div className="analysis-legend">
          <p style={{ color: firstColor }}>
            {firstLabel}: {formatPercent(firstPercent)}
          </p>
          <p style={{ color: secondColor }}>
            {secondLabel}: {formatPercent(secondPercent)}
          </p>
        </div>
      </div>
    </section>
  )
}

const buildInsights = (overview: OverviewStats) => {
  const items: string[] = []

  if (!overview.tradeCount) {
    return ['No trades in this timeframe yet. Import trades to generate personalized insights.']
  }

  items.push(
    `${overview.timeframeLabel}: ${overview.tradeCount} trades, ${formatPercent(overview.winRate)} win rate, ${formatMoney(
      overview.netAfterFees
    )} after fees.`
  )

  if (overview.topSymbol && overview.weakestSymbol) {
    items.push(
      `Symbol edge: ${overview.topSymbol.ticker} leads at ${formatMoney(
        overview.topSymbol.pnl
      )}, while ${overview.weakestSymbol.ticker} drags at ${formatMoney(overview.weakestSymbol.pnl)}.`
    )
  }

  if (overview.longCount || overview.shortCount) {
    const bias =
      overview.longCount === overview.shortCount
        ? 'balanced side exposure'
        : overview.longCount > overview.shortCount
          ? 'long bias'
          : 'short bias'
    items.push(
      `Trading style read: ${bias}. Longs: ${overview.longCount} (${formatMoney(
        overview.longPnl
      )}) vs Shorts: ${overview.shortCount} (${formatMoney(overview.shortPnl)}).`
    )
  }

  const bestTime = [...overview.timeOfDay].sort((a, b) => b.value - a.value)[0]
  const weakTime = [...overview.timeOfDay].sort((a, b) => a.value - b.value)[0]
  if (bestTime && weakTime) {
    items.push(
      `Session timing: strongest window is ${bestTime.label} (${formatMoney(bestTime.value)}), weakest is ${weakTime.label} (${formatMoney(weakTime.value)}).`
    )
  }

  if (overview.avgLoss !== 0 && Math.abs(overview.avgLoss) > overview.avgWin) {
    items.push(
      `Risk skew warning: average loss ${formatMoney(overview.avgLoss)} is larger than average win ${formatMoney(
        overview.avgWin
      )}. Prioritize faster loss cuts.`
    )
  } else {
    items.push(
      `Payoff profile is healthy: avg win ${formatMoney(overview.avgWin)} vs avg loss ${formatMoney(overview.avgLoss)}.`
    )
  }

  if (overview.fees > 0) {
    const feeShare = overview.totalLoss + overview.fees > 0 ? (overview.fees / (overview.totalLoss + overview.fees)) * 100 : 0
    items.push(
      `Cost pressure: fees are ${formatMoney(overview.fees)} and account for ${formatPercent(
        feeShare
      )} of total negative drag (losses + fees).`
    )
  }

  items.push(
    `Consistency check: expectancy ${formatMoney(overview.expectancy)} per trade with P/L volatility of ${formatMoney(
      overview.pnlStdDev
    )}.`
  )

  if (overview.symbolRows.length >= 2) {
    const topThree = overview.symbolRows.slice(0, 3).map((row) => `${row.ticker} ${formatMoney(row.pnl)}`).join(', ')
    items.push(`Focus list: keep size concentrated on your strongest symbols: ${topThree}.`)
  }

  return items
}

export function AnalysisPage({
  trades,
  userId,
  selectedAccounts = null,
  defaultView = 'overview'
}: Props) {
  const [loadedTrades, setLoadedTrades] = useState<Trade[]>(trades)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<AnalysisTimeframe>('daily')
  const [view, setView] = useState<'overview' | 'insights'>(defaultView)

  useEffect(() => {
    setView(defaultView)
  }, [defaultView])

  useEffect(() => {
    const fetchTrades = async () => {
      if (!userId) {
        setLoadedTrades([])
        setLoading(false)
        return
      }
      if (selectedAccounts !== null && !selectedAccounts.length) {
        setLoadedTrades([])
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      let query = supabase.from('trades').select('*').order('entry_ts', { ascending: false })
      if (userId) {
        query = query.eq('user_id', userId)
      }
      if (selectedAccounts && selectedAccounts.length) {
        query = query.in('source_account', selectedAccounts)
      }

      const { data, error: supaError } = await query
      if (supaError) {
        setError('Unable to load trades from Supabase.')
        setLoading(false)
        return
      }

      const normalized: Trade[] = ((data ?? []) as TradeRow[]).map((row) => normalizeTradeRow(row))
      setLoadedTrades(normalized)
      setLoading(false)
    }

    fetchTrades()
  }, [userId, selectedAccounts])

  const active = useMemo(() => buildOverviewStats(loadedTrades, timeframe), [loadedTrades, timeframe])
  const insights = useMemo(() => buildInsights(active), [active])

  const winningVsLosing = {
    wins: active.winCount,
    losses: active.lossCount
  }

  return (
    <>
      <PageHeader title="Analysis" subtitle="Merged analysis and insights across your imported trades" />

      <section className="panel analysis-workspace">
        <div className="panel-header">
          <div className="panel-title">Analysis Workspace</div>
          <div className="stats-tabs">
            <button
              type="button"
              className={`tab ${view === 'overview' ? 'filled' : ''}`}
              onClick={() => setView('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              className={`tab ${view === 'insights' ? 'filled' : ''}`}
              onClick={() => setView('insights')}
            >
              Insights
            </button>
          </div>
        </div>

        <div className="stats-tabs">
          {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((range) => (
            <button
              key={range}
              type="button"
              className={`tab ${timeframe === range ? 'filled' : ''}`}
              onClick={() => setTimeframe(range)}
            >
              {range[0].toUpperCase() + range.slice(1)}
            </button>
          ))}
          <span className="chip filled">{active.timeframeLabel}</span>
        </div>

        {view === 'overview' ? (
          <>
            <div className="analysis-summary-cards">
              <section className="panel analysis-stat-card">
                <div className="panel-title">All Trades</div>
                <div className="analysis-stat-row"><span>Gross P/L</span><strong>{formatMoney(active.grossPnl)}</strong></div>
                <div className="analysis-stat-row"><span># of Trades</span><strong>{active.tradeCount}</strong></div>
                <div className="analysis-stat-row"><span># of Contracts</span><strong>{active.contracts}</strong></div>
                <div className="analysis-stat-row"><span>Avg Trade Time</span><strong>{formatDuration(active.avgTradeDurationSec)}</strong></div>
                <div className="analysis-stat-row"><span>Longest Trade Time</span><strong>{formatDuration(active.longestTradeDurationSec)}</strong></div>
                <div className="analysis-stat-row"><span>% Profitable</span><strong>{formatPercent(active.winRate)}</strong></div>
                <div className="analysis-stat-row"><span>Expectancy</span><strong>{formatMoney(active.expectancy)}</strong></div>
                <div className="analysis-stat-row"><span>Total P/L</span><strong>{formatMoney(active.netAfterFees)}</strong></div>
              </section>

              <section className="panel analysis-stat-card">
                <div className="panel-title">Profit Trades</div>
                <div className="analysis-stat-row"><span>Total Profit</span><strong>{formatMoney(active.totalProfit)}</strong></div>
                <div className="analysis-stat-row"><span># Winning Trades</span><strong>{active.winCount}</strong></div>
                <div className="analysis-stat-row"><span>Largest Winning Trade</span><strong>{formatMoney(active.largestWin)}</strong></div>
                <div className="analysis-stat-row"><span>Avg Winning Trade</span><strong>{formatMoney(active.avgWin)}</strong></div>
                <div className="analysis-stat-row"><span>Avg Winning Time</span><strong>{formatDuration(active.avgWinningDurationSec)}</strong></div>
                <div className="analysis-stat-row"><span>Longest Winning Time</span><strong>{formatDuration(active.longestWinningDurationSec)}</strong></div>
                <div className="analysis-stat-row"><span>Long P/L</span><strong>{formatMoney(active.longPnl)}</strong></div>
                <div className="analysis-stat-row"><span>Top Symbol</span><strong>{active.topSymbol?.ticker ?? 'N/A'}</strong></div>
              </section>

              <section className="panel analysis-stat-card">
                <div className="panel-title">Losing Trades</div>
                <div className="analysis-stat-row"><span>Total Loss</span><strong>{formatMoney(-active.totalLoss)}</strong></div>
                <div className="analysis-stat-row"><span># Losing Trades</span><strong>{active.lossCount}</strong></div>
                <div className="analysis-stat-row"><span>Largest Losing Trade</span><strong>{formatMoney(active.largestLoss)}</strong></div>
                <div className="analysis-stat-row"><span>Avg Losing Trade</span><strong>{formatMoney(active.avgLoss)}</strong></div>
                <div className="analysis-stat-row"><span>Avg Losing Time</span><strong>{formatDuration(active.avgLosingDurationSec)}</strong></div>
                <div className="analysis-stat-row"><span>Longest Losing Time</span><strong>{formatDuration(active.longestLosingDurationSec)}</strong></div>
                <div className="analysis-stat-row"><span>Short P/L</span><strong>{formatMoney(active.shortPnl)}</strong></div>
                <div className="analysis-stat-row"><span>Fees & Comm.</span><strong>{formatMoney(active.fees)}</strong></div>
              </section>
            </div>

            <div className="analysis-chart-grid">
              <PieCard
                title="Winning vs Losing Trades"
                firstLabel="Winning Trades"
                firstValue={winningVsLosing.wins}
                secondLabel="Losing Trades"
                secondValue={winningVsLosing.losses}
                firstColor="#34c759"
                secondColor="#ff375f"
              />

              <section className="panel analysis-chart-card">
                <div className="panel-title">P/L History</div>
                <BarChart points={active.pnlHistory} positiveNegative />
              </section>

              <section className="panel analysis-chart-card">
                <div className="panel-title">P/L History (Cumulative Without Fees)</div>
                <BarChart points={active.cumulativeNoFees} />
              </section>

              <section className="panel analysis-chart-card">
                <div className="panel-title">P/L History (Cumulative With Fees)</div>
                <BarChart points={active.cumulativeWithFees} />
              </section>

              <section className="panel analysis-chart-card">
                <div className="panel-title">P/L Distribution</div>
                <BarChart points={active.pnlDistribution.map((row) => ({ ...row, value: row.value }))} />
              </section>

              <section className="panel analysis-chart-card">
                <div className="panel-title">P/L Per Time of Day</div>
                <BarChart points={active.timeOfDay} positiveNegative />
              </section>

              <PieCard
                title="Gross Loss Breakdown"
                firstLabel="Loss Trades"
                firstValue={active.feesVsLosses.losses}
                secondLabel="Commissions"
                secondValue={active.feesVsLosses.fees}
                firstColor="#ff2d55"
                secondColor="#ff9f0a"
              />

              <section className="panel analysis-chart-card">
                <div className="panel-title">Symbol Performance</div>
                <div className="analysis-symbol-table">
                  <div className="analysis-symbol-head">
                    <span>Symbol</span>
                    <span>Trades</span>
                    <span>Win Rate</span>
                    <span>P/L</span>
                  </div>
                  {active.symbolRows.slice(0, 6).map((row) => (
                    <div key={row.ticker} className="analysis-symbol-row">
                      <span>{row.ticker}</span>
                      <span>{row.count}</span>
                      <span>{formatPercent(row.winRate)}</span>
                      <span className={row.pnl >= 0 ? 'success' : 'danger'}>{formatMoney(row.pnl)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="analysis-insights-layout">
            <section className="analysis-notes panel">
              <div className="panel-title">Actionable Insights</div>
              {insights.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </section>
            <section className="analysis-focus panel">
              <div className="panel-title">Style Snapshot</div>
              <div className="analysis-focus-list">
                <p>Primary Symbol: {active.topSymbol?.ticker ?? 'N/A'}</p>
                <p>Best Symbol Expectancy: {active.topSymbol ? formatMoney(active.topSymbol.expectancy) : 'N/A'}</p>
                <p>Weak Symbol Expectancy: {active.weakestSymbol ? formatMoney(active.weakestSymbol.expectancy) : 'N/A'}</p>
                <p>Directional Profile: {active.longCount} long / {active.shortCount} short</p>
                <p>Volatility of Results: {formatMoney(active.pnlStdDev)} per trade</p>
                <p>Net After Fees: {formatMoney(active.netAfterFees)}</p>
              </div>
            </section>
          </div>
        )}
      </section>

      {error && <div className="muted">Error: {error}</div>}
      {loading && <div className="muted">Loading trades...</div>}
    </>
  )
}
