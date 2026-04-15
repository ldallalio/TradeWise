import type { Trade } from '../data/mockData'
import { formatLocalDate, getTradeDate } from './trades'
import { shouldHideFilledZeroPnl } from './tradeFilters'

const getNetPnl = (trade: Trade) => {
  const pnl = Number(trade.pnl) || 0
  const fee = Number(trade.commission) || 0
  const payload = trade.raw_payload as Record<string, unknown> | null | undefined
  const pnlIncludesFees = Boolean(payload?._pnl_includes_fees)
  return pnlIncludesFees ? pnl : pnl - fee
}

export type AnalysisTimeframe = 'daily' | 'weekly' | 'monthly' | 'yearly'

export type TradeAnalysis = {
  timeframe: AnalysisTimeframe
  periodLabel: string
  tradeCount: number
  activePeriods: number
  netPnl: number
  grossProfit: number
  grossLoss: number
  fees: number
  netAfterFees: number
  winRate: number
  profitFactor: number
  expectancy: number
  avgWin: number
  avgLoss: number
  largestWin: number
  largestLoss: number
  longCount: number
  shortCount: number
  avgContracts: number
  avgPnlPerPeriod: number
  bestPeriod: { label: string; pnl: number } | null
  worstPeriod: { label: string; pnl: number } | null
  bestTicker: { ticker: string; pnl: number } | null
  worstTicker: { ticker: string; pnl: number } | null
  longestWinStreak: number
  longestLossStreak: number
  insights: string[]
}

const pad = (value: number) => `${value}`.padStart(2, '0')

const startOfWeek = (value: Date) => {
  const clone = new Date(value)
  const day = clone.getDay()
  const diff = day === 0 ? -6 : 1 - day
  clone.setDate(clone.getDate() + diff)
  clone.setHours(0, 0, 0, 0)
  return clone
}

const getPeriodKey = (value: Date, timeframe: AnalysisTimeframe) => {
  if (timeframe === 'daily') return formatLocalDate(value)
  if (timeframe === 'weekly') return `W:${formatLocalDate(startOfWeek(value))}`
  if (timeframe === 'monthly') return `${value.getFullYear()}-${pad(value.getMonth() + 1)}`
  return `${value.getFullYear()}`
}

const formatPeriodKey = (key: string, timeframe: AnalysisTimeframe) => {
  if (timeframe === 'daily') return key
  if (timeframe === 'weekly') {
    const raw = key.replace('W:', '')
    const date = new Date(`${raw}T00:00:00`)
    if (Number.isNaN(date.getTime())) return raw
    return `Week of ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  if (timeframe === 'monthly') {
    const [year, month] = key.split('-')
    const date = new Date(Number(year), Number(month) - 1, 1)
    if (Number.isNaN(date.getTime())) return key
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  return key
}

const formatMoney = (value: number) => {
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const buildInsights = (analysis: Omit<TradeAnalysis, 'insights'>) => {
  if (!analysis.tradeCount) {
    return ['No trades available for analysis yet. Import more trades to unlock actionable insights.']
  }

  const insights: string[] = []
  insights.push(
    `Across ${analysis.tradeCount} trades, net P/L is ${formatMoney(analysis.netPnl)} (${formatMoney(
      analysis.netAfterFees
    )} after ${formatMoney(analysis.fees)} in recorded fees).`
  )

  insights.push(
    `${analysis.periodLabel}: ${analysis.activePeriods} active periods with an average of ${formatMoney(
      analysis.avgPnlPerPeriod
    )} per period.`
  )

  if (analysis.bestPeriod && analysis.worstPeriod) {
    insights.push(
      `Best ${analysis.periodLabel.toLowerCase()} was ${analysis.bestPeriod.label} at ${formatMoney(
        analysis.bestPeriod.pnl
      )}; worst was ${analysis.worstPeriod.label} at ${formatMoney(analysis.worstPeriod.pnl)}.`
    )
  }

  insights.push(
    `Win rate is ${analysis.winRate.toFixed(1)}% with expectancy ${formatMoney(
      analysis.expectancy
    )} per trade and profit factor ${analysis.profitFactor.toFixed(2)}.`
  )

  if (analysis.bestTicker && analysis.worstTicker) {
    insights.push(
      `Top contributor: ${analysis.bestTicker.ticker} (${formatMoney(analysis.bestTicker.pnl)}). ` +
        `Largest drag: ${analysis.worstTicker.ticker} (${formatMoney(analysis.worstTicker.pnl)}).`
    )
  }

  insights.push(
    `Positioning bias: ${analysis.longCount} long vs ${analysis.shortCount} short trades; average size ${analysis.avgContracts.toFixed(
      2
    )} contracts.`
  )

  insights.push(
    `Streak profile: longest winning streak ${analysis.longestWinStreak}, longest losing streak ${analysis.longestLossStreak}.`
  )

  return insights
}

const emptyAnalysis = (timeframe: AnalysisTimeframe): TradeAnalysis => {
  const periodLabelMap: Record<AnalysisTimeframe, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    yearly: 'Yearly'
  }

  const base = {
    timeframe,
    periodLabel: periodLabelMap[timeframe],
    tradeCount: 0,
    activePeriods: 0,
    netPnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    fees: 0,
    netAfterFees: 0,
    winRate: 0,
    profitFactor: 0,
    expectancy: 0,
    avgWin: 0,
    avgLoss: 0,
    largestWin: 0,
    largestLoss: 0,
    longCount: 0,
    shortCount: 0,
    avgContracts: 0,
    avgPnlPerPeriod: 0,
    bestPeriod: null,
    worstPeriod: null,
    bestTicker: null,
    worstTicker: null,
    longestWinStreak: 0,
    longestLossStreak: 0
  }

  return {
    ...base,
    insights: buildInsights(base)
  }
}

const buildSingleAnalysis = (trades: Trade[], timeframe: AnalysisTimeframe): TradeAnalysis => {
  const normalized = trades
    .filter((trade) => !shouldHideFilledZeroPnl(trade))
    .map((trade) => ({ trade, dt: getTradeDate(trade) }))
    .filter((row): row is { trade: Trade; dt: Date } => Boolean(row.dt))
    .sort((left, right) => left.dt.getTime() - right.dt.getTime())

  if (!normalized.length) return emptyAnalysis(timeframe)

  const periodMap = new Map<string, number>()
  const tickerMap = new Map<string, number>()

  let netPnl = 0
  let grossProfit = 0
  let grossLoss = 0
  let fees = 0
  let winCount = 0
  let lossCount = 0
  let totalQty = 0
  let longCount = 0
  let shortCount = 0
  let largestWin = Number.NEGATIVE_INFINITY
  let largestLoss = Number.POSITIVE_INFINITY
  let currentWinStreak = 0
  let currentLossStreak = 0
  let longestWinStreak = 0
  let longestLossStreak = 0

  for (const row of normalized) {
    const pnl = getNetPnl(row.trade)
    const qty = Math.abs(Number(row.trade.qty) || 0)
    const fee = Number(row.trade.commission) || 0
    const side = (row.trade.side || '').toLowerCase()

    netPnl += pnl
    totalQty += qty
    fees += fee

    if (pnl > 0) {
      grossProfit += pnl
      winCount += 1
      largestWin = Math.max(largestWin, pnl)
      currentWinStreak += 1
      currentLossStreak = 0
    } else if (pnl < 0) {
      grossLoss += pnl
      lossCount += 1
      largestLoss = Math.min(largestLoss, pnl)
      currentLossStreak += 1
      currentWinStreak = 0
    } else {
      currentWinStreak = 0
      currentLossStreak = 0
    }

    longestWinStreak = Math.max(longestWinStreak, currentWinStreak)
    longestLossStreak = Math.max(longestLossStreak, currentLossStreak)

    if (side === 'long' || side === 'buy') longCount += 1
    if (side === 'short' || side === 'sell') shortCount += 1

    const periodKey = getPeriodKey(row.dt, timeframe)
    periodMap.set(periodKey, (periodMap.get(periodKey) ?? 0) + pnl)

    const ticker = (row.trade.ticker || 'Unknown').toUpperCase()
    tickerMap.set(ticker, (tickerMap.get(ticker) ?? 0) + pnl)
  }

  const tradeCount = normalized.length
  const activePeriods = periodMap.size
  const countedTrades = winCount + lossCount
  const avgWin = winCount ? grossProfit / winCount : 0
  const avgLoss = lossCount ? grossLoss / lossCount : 0
  const winRate = countedTrades ? (winCount / countedTrades) * 100 : 0
  const profitFactor = grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : 0
  const expectancy = tradeCount ? netPnl / tradeCount : 0
  const avgContracts = tradeCount ? totalQty / tradeCount : 0
  const avgPnlPerPeriod = activePeriods ? netPnl / activePeriods : 0

  const periods = Array.from(periodMap.entries())
  const bestPeriod = periods.length
    ? periods.reduce((best, current) => (current[1] > best[1] ? current : best), periods[0])
    : null
  const worstPeriod = periods.length
    ? periods.reduce((worst, current) => (current[1] < worst[1] ? current : worst), periods[0])
    : null

  const tickers = Array.from(tickerMap.entries())
  const bestTicker = tickers.length
    ? tickers.reduce((best, current) => (current[1] > best[1] ? current : best), tickers[0])
    : null
  const worstTicker = tickers.length
    ? tickers.reduce((worst, current) => (current[1] < worst[1] ? current : worst), tickers[0])
    : null

  const periodLabelMap: Record<AnalysisTimeframe, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    yearly: 'Yearly'
  }

  const base: Omit<TradeAnalysis, 'insights'> = {
    timeframe,
    periodLabel: periodLabelMap[timeframe],
    tradeCount,
    activePeriods,
    netPnl,
    grossProfit,
    grossLoss,
    fees,
    netAfterFees: netPnl,
    winRate,
    profitFactor,
    expectancy,
    avgWin,
    avgLoss,
    largestWin: largestWin === Number.NEGATIVE_INFINITY ? 0 : largestWin,
    largestLoss: largestLoss === Number.POSITIVE_INFINITY ? 0 : largestLoss,
    longCount,
    shortCount,
    avgContracts,
    avgPnlPerPeriod,
    bestPeriod: bestPeriod
      ? { label: formatPeriodKey(bestPeriod[0], timeframe), pnl: bestPeriod[1] }
      : null,
    worstPeriod: worstPeriod
      ? { label: formatPeriodKey(worstPeriod[0], timeframe), pnl: worstPeriod[1] }
      : null,
    bestTicker: bestTicker ? { ticker: bestTicker[0], pnl: bestTicker[1] } : null,
    worstTicker: worstTicker ? { ticker: worstTicker[0], pnl: worstTicker[1] } : null,
    longestWinStreak,
    longestLossStreak
  }

  return {
    ...base,
    insights: buildInsights(base)
  }
}

export const buildTradeAnalysis = (trades: Trade[]) => {
  return {
    daily: buildSingleAnalysis(trades, 'daily'),
    weekly: buildSingleAnalysis(trades, 'weekly'),
    monthly: buildSingleAnalysis(trades, 'monthly'),
    yearly: buildSingleAnalysis(trades, 'yearly')
  }
}
