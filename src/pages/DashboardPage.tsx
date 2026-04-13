import { useEffect, useMemo, useState } from 'react'
import type { Badge, MonthReturn, StatCard, Trade } from '../data/mockData'
import { badges, monthReturnsByMonth, statsByRange } from '../data/mockData'
import { TradesTable } from '../components/TradesTable'
import { PageHeader } from '../components/PageHeader'
import { supabase } from '../supabaseClient'
import { aggregateStats, formatCurrency, groupMonthlyReturns } from '../utils/stats'
import { getTradeDate, normalizeTradeRow, type TradeRow } from '../utils/trades'
import { buildTradeAnalysis, type AnalysisTimeframe } from '../utils/tradeAnalysis'

type Props = {
  trades: Trade[]
  userId?: string
  selectedAccounts?: string[] | null
}

export function DashboardPage({ trades, userId, selectedAccounts = null }: Props) {
  const [loadedTrades, setLoadedTrades] = useState<Trade[]>(trades)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statRange, setStatRange] = useState<keyof typeof statsByRange>('All Time')
  const [statView, setStatView] = useState<'Key Stats' | 'All Stats'>('Key Stats')
  const [monthFocus, setMonthFocus] = useState<keyof typeof monthReturnsByMonth>('November 2025')
  const [analysisRange, setAnalysisRange] = useState<AnalysisTimeframe>('daily')

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

  const activeTrades = useMemo(() => loadedTrades, [loadedTrades])
  const filteredByRange = useMemo(() => {
    if (statRange === 'All Time') return activeTrades
    const now = new Date()
    const days = statRange === 'Last 30D' ? 30 : 7
    const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
    return activeTrades.filter((t) => {
      const dt = getTradeDate(t)
      if (!dt) return false
      return dt.getTime() >= cutoff
    })
  }, [activeTrades, statRange])

  const computedStats = useMemo(() => aggregateStats(filteredByRange), [filteredByRange])
  const statsToShow: StatCard[] = useMemo(() => {
    const template = statsByRange[statRange]
    return template.map((card) => {
      if (card.title === 'Cumulative Return') return { ...card, value: formatCurrency(computedStats.cumulativeReturn) }
      if (card.title === 'Profit Factor') return { ...card, value: computedStats.profitFactor.toFixed(2) }
      if (card.title === 'Average Return')
        return { ...card, value: formatCurrency(Math.round(computedStats.averageReturn * 100) / 100) }
      if (card.title === 'Win Rate') return { ...card, value: `${computedStats.winRate.toFixed(1)}%` }
      return card
    })
  }, [computedStats, statRange])

  const activeMonthReturns: MonthReturn[] = useMemo(() => {
    const derived = groupMonthlyReturns(activeTrades, monthFocus)
    if (derived.length) return derived
    return monthReturnsByMonth[monthFocus] ?? []
  }, [activeTrades, monthFocus])

  const monthList = Object.keys(monthReturnsByMonth) as (keyof typeof monthReturnsByMonth)[]
  const monthIndex = monthList.indexOf(monthFocus)
  const analysisByRange = useMemo(() => buildTradeAnalysis(activeTrades), [activeTrades])
  const activeAnalysis = analysisByRange[analysisRange]

  const formatDetailedCurrency = (value: number) =>
    `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`

  const goPrevMonth = () => {
    if (monthIndex < monthList.length - 1) {
      setMonthFocus(monthList[monthIndex + 1])
    }
  }

  const goNextMonth = () => {
    if (monthIndex > 0) {
      setMonthFocus(monthList[monthIndex - 1])
    }
  }

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Your trading overview" />

      <section className="panel stats">
        <div className="panel-header">
          <div className="panel-title">Statistics</div>
          <div className="chip-row">
            {(['All Time', 'Last 30D', 'Last 7D'] as const).map((range) => (
              <button
                key={range}
                className={`chip ${statRange === range ? 'filled' : ''}`}
                onClick={() => setStatRange(range)}
                type="button"
              >
                {range}
              </button>
            ))}
          </div>
        </div>
        <div className="stats-tabs">
          {(['Key Stats', 'All Stats'] as const).map((view) => (
            <button
              key={view}
              className={`tab ${statView === view ? 'filled' : ''}`}
              onClick={() => setStatView(view)}
              type="button"
            >
              {view}
            </button>
          ))}
        </div>
        <div className="stat-grid">
          {statsToShow.map((card) => (
            <div key={card.title} className="stat-card">
              <div className="stat-meta">
                <div>{card.title}</div>
              </div>
              <div className="stat-value">{card.value}</div>
              {card.type === 'chart' && <div className="mini-chart" />}
              {card.type === 'donut' && <div className="mini-donut" />}
            </div>
          ))}
        </div>
      </section>

      <div className="grid two">
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">Badges</div>
            <a className="link" href="#">
              View all
            </a>
          </div>
          <div className="badge-row">
            {badges.map((badge: Badge) => (
              <div key={badge.title} className={`badge badge-${badge.color}`}>
                <div className="badge-icon" />
                <div className="badge-title">{badge.title}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel tip">
          <div className="panel-title">Tip of the Day</div>
          <div className="tip-body">
            <div className="tip-title">Technical vs Fundamental</div>
            <p>
              Don&apos;t limit yourself to one approach. The best traders often combine technical and
              fundamental analysis for a more complete market perspective.
            </p>
          </div>
        </section>
      </div>

      <div className="grid two">
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">Month Returns</div>
            <div className="chip-row">
              <button className="tab" onClick={goPrevMonth} disabled={monthIndex === monthList.length - 1}>
                Previous
              </button>
              <span className="chip filled">{monthFocus}</span>
              <button className="tab" onClick={goNextMonth} disabled={monthIndex === 0}>
                Next
              </button>
            </div>
          </div>
          <div className="bar-chart">
            {activeMonthReturns.map((entry) => (
              <div key={entry.label} className="bar-col">
                <div
                  className={`bar-fill ${entry.value >= 0 ? 'positive' : 'negative'}`}
                  style={{ height: `${Math.min(Math.abs(entry.value), 320) / 4}px` }}
                />
                <span className="bar-label">{entry.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel analysis-panel">
          <div className="panel-header">
            <div className="panel-title">Analysis</div>
            <div className="stats-tabs">
              {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((range) => (
                <button
                  key={range}
                  type="button"
                  className={`tab ${analysisRange === range ? 'filled' : ''}`}
                  onClick={() => setAnalysisRange(range)}
                >
                  {range[0].toUpperCase() + range.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="analysis-grid">
            <div className="analysis-metric">
              <span>Trades</span>
              <strong>{activeAnalysis.tradeCount}</strong>
            </div>
            <div className="analysis-metric">
              <span>Net P/L</span>
              <strong>{formatDetailedCurrency(activeAnalysis.netPnl)}</strong>
            </div>
            <div className="analysis-metric">
              <span>Win Rate</span>
              <strong>{activeAnalysis.winRate.toFixed(1)}%</strong>
            </div>
            <div className="analysis-metric">
              <span>Profit Factor</span>
              <strong>{Number.isFinite(activeAnalysis.profitFactor) ? activeAnalysis.profitFactor.toFixed(2) : 'Infinity'}</strong>
            </div>
            <div className="analysis-metric">
              <span>Expectancy</span>
              <strong>{formatDetailedCurrency(activeAnalysis.expectancy)}</strong>
            </div>
            <div className="analysis-metric">
              <span>Avg Contracts</span>
              <strong>{activeAnalysis.avgContracts.toFixed(2)}</strong>
            </div>
          </div>

          <div className="analysis-summary-row">
            <span>Best {activeAnalysis.periodLabel}</span>
            <strong>
              {activeAnalysis.bestPeriod
                ? `${activeAnalysis.bestPeriod.label} (${formatDetailedCurrency(activeAnalysis.bestPeriod.pnl)})`
                : 'N/A'}
            </strong>
          </div>
          <div className="analysis-summary-row">
            <span>Worst {activeAnalysis.periodLabel}</span>
            <strong>
              {activeAnalysis.worstPeriod
                ? `${activeAnalysis.worstPeriod.label} (${formatDetailedCurrency(activeAnalysis.worstPeriod.pnl)})`
                : 'N/A'}
            </strong>
          </div>

          <div className="analysis-summary-row">
            <span>Top Ticker</span>
            <strong>
              {activeAnalysis.bestTicker
                ? `${activeAnalysis.bestTicker.ticker} (${formatDetailedCurrency(activeAnalysis.bestTicker.pnl)})`
                : 'N/A'}
            </strong>
          </div>

          <div className="analysis-notes">
            {activeAnalysis.insights.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </section>
      </div>

      {error && <div className="muted">Error: {error}</div>}
      {loading ? <div className="muted">Loading trades...</div> : <TradesTable trades={activeTrades} title="Recent Trades" />}
    </>
  )
}
