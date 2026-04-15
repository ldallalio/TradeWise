import type { Trade } from '../data/mockData'
import { getTradeDate } from './trades'

const getNetPnl = (trade: Trade) => {
  const pnl = Number(trade.pnl) || 0
  const fee = Number(trade.commission) || 0
  const payload = trade.raw_payload as Record<string, unknown> | null | undefined
  const pnlIncludesFees = Boolean(payload?._pnl_includes_fees)
  return pnlIncludesFees ? pnl : pnl - fee
}

export type AggregateStats = {
  cumulativeReturn: number
  profitFactor: number
  averageReturn: number
  winRate: number
}

export const formatCurrency = (value: number) =>
  (value < 0 ? '-' : '') + '$' + Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 0 })

export function aggregateStats(trades: Trade[]): AggregateStats {
  if (!trades.length) {
    return { cumulativeReturn: 0, profitFactor: 0, averageReturn: 0, winRate: 0 }
  }
  const netPnls = trades.map((trade) => getNetPnl(trade))
  const totalPnl = netPnls.reduce((sum, value) => sum + value, 0)
  const wins = netPnls.filter((value) => value > 0)
  const losses = netPnls.filter((value) => value < 0)
  const winSum = wins.reduce((sum, value) => sum + value, 0)
  const lossSum = losses.reduce((sum, value) => sum + value, 0) // negative
  const profitFactor = wins.length
    ? lossSum !== 0
      ? winSum / Math.abs(lossSum)
      : Infinity
    : 0
  const averageReturn = totalPnl / trades.length
  const countedTrades = wins.length + losses.length
  const winRate = countedTrades ? (wins.length / countedTrades) * 100 : 0
  return {
    cumulativeReturn: totalPnl,
    profitFactor,
    averageReturn,
    winRate
  }
}

export function groupMonthlyReturns(trades: Trade[], monthFocus: string) {
  // monthFocus like "November 2025"
  const [monthName, yearStr] = monthFocus.split(' ')
  const monthIndex = new Date(`${monthName} 1, ${yearStr}`).getMonth()
  const yearNum = Number(yearStr)

  const buckets = new Map<string, number>()
  trades.forEach((trade) => {
    const d = getTradeDate(trade)
    if (!d) return
    if (d.getFullYear() === yearNum && d.getMonth() === monthIndex) {
      const day = `${d.getDate()}`.padStart(2, '0')
      buckets.set(day, (buckets.get(day) ?? 0) + getNetPnl(trade))
    }
  })

  return Array.from(buckets.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([label, value]) => ({ label, value }))
}
