import { useEffect, useState } from 'react'
import type { Trade } from '../data/mockData'
import { formatCurrency } from '../utils/stats'
import { shouldHideFilledZeroPnl } from '../utils/tradeFilters'

type Props = {
  trades: Trade[]
  title: string
  pageSize?: number
}

export function TradesTable({ trades, title, pageSize = 10 }: Props) {
  const [page, setPage] = useState(1)
  const visibleTrades = trades.filter((trade) => !shouldHideFilledZeroPnl(trade))
  const totalPages = Math.max(1, Math.ceil(visibleTrades.length / pageSize))

  useEffect(() => {
    setPage(1)
  }, [trades, pageSize])

  const paginatedTrades = visibleTrades.slice((page - 1) * pageSize, page * pageSize)
  return (
    <section className="panel table">
      <div className="panel-header">
        <div className="panel-title">{title}</div>
        <div className="table-pagination">
          <button className="small-btn" type="button" onClick={() => setPage((p: number) => Math.max(1, p - 1))} disabled={page === 1}>
            ‹
          </button>
          <span className="muted tiny">
            Page {page} / {totalPages}
          </span>
          <button className="small-btn" type="button" onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            ›
          </button>
        </div>
      </div>
      <div className="table-body">
        <div className="table-head">
          <span>Entry Date</span>
          <span>Entry Time</span>
          <span>Side</span>
          <span>Ticker/Type</span>
          <span>Quantity</span>
          <span>PnL</span>
        </div>
        {paginatedTrades.length ? (
          paginatedTrades.map((trade) => (
            <div key={`${trade.date}-${trade.time}-${trade.ticker}`} className="table-row">
              <span className="muted">{trade.date}</span>
              <span className="muted">{trade.time}</span>
              <span>{trade.side}</span>
              <span>
                <span className="pill gold">{trade.type}</span> {trade.ticker}
              </span>
              <span>{trade.qty}</span>
              <span className={trade.pnl >= 0 ? 'success' : 'danger'}>
                {formatCurrency(trade.pnl)}
                <div className="muted tiny">{trade.change}</div>
              </span>
            </div>
          ))
        ) : (
          <div className="table-row">
            <span className="muted">No trades with PnL to display.</span>
          </div>
        )}
      </div>
    </section>
  )
}
