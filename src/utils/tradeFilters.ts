import type { Trade } from '../data/mockData'

export const shouldHideFilledZeroPnl = (trade: Trade) => {
  const status = (trade.change || '').trim().toLowerCase()
  const pnl = typeof trade.pnl === 'number' ? trade.pnl : 0
  const isZero = Math.abs(pnl) < 1e-6
  return status === 'filled' && isZero
}
