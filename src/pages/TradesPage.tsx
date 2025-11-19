import { useEffect, useMemo, useState } from 'react'
import type { Trade } from '../data/mockData'
import { PageHeader } from '../components/PageHeader'
import { TradesTable } from '../components/TradesTable'
import { supabase } from '../supabaseClient'

type Props = {
  trades: Trade[]
  userId?: string
  selectedAccounts?: string[] | null
}

export function TradesPage({ trades, userId, selectedAccounts = null }: Props) {
  const [sideFilter, setSideFilter] = useState<'All' | 'Long' | 'Short'>('All')
  const [loadedTrades, setLoadedTrades] = useState<Trade[]>(trades)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchTrades = async () => {
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
      setLoadedTrades(normalized)
      setLoading(false)
    }
    fetchTrades()
  }, [userId, selectedAccounts])

  const filteredTrades = useMemo(
    () => (sideFilter === 'All' ? loadedTrades : loadedTrades.filter((t) => t.side === sideFilter)),
    [sideFilter, loadedTrades]
  )

  return (
    <>
      <PageHeader title="Trades" subtitle="All executions" />
      <div className="panel table-controls">
        <div className="chip-row">
          {(['All', 'Long', 'Short'] as const).map((val) => (
            <button
              key={val}
              className={`chip ${sideFilter === val ? 'filled' : ''}`}
              onClick={() => setSideFilter(val)}
              type="button"
            >
              {val}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="muted">Error: {error}</div>}
      {loading ? <div className="muted">Loading trades...</div> : <TradesTable trades={filteredTrades} title="Recent Trades" />}

      <section className="panel">
        <div className="panel-title">Filters & Import</div>
        <p className="muted">
          This page can expand with filtering, bulk actions, and broker imports. The static table above mirrors
          the mock data from the design.
        </p>
      </section>
    </>
  )
}
