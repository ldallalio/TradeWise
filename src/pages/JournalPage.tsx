import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Trade } from '../data/mockData'
import { PageHeader } from '../components/PageHeader'
import { supabase } from '../supabaseClient'
import { formatLocalDate, getTradeDate, normalizeTradeRow, type TradeRow } from '../utils/trades'

type Props = {
  trades: Trade[]
  userId?: string
  selectedAccounts?: string[] | null
}

type JournalEntry = {
  id: string
  createdAt: string
  tradeDate: string
  title: string
  symbol: string
  mood: 'confident' | 'neutral' | 'frustrated' | 'focused'
  tags: string[]
  notes: string
}

type JournalEntryRow = {
  id: string
  created_at: string
  trade_date: string
  title: string
  symbol: string | null
  mood: JournalEntry['mood']
  tags: string[] | null
  notes: string
}

const normalizeTagList = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8)

const isDateValue = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))

const readCachedEntries = (storageKey: string) => {
  const saved = localStorage.getItem(storageKey)
  if (!saved) return [] as JournalEntry[]
  try {
    return JSON.parse(saved) as JournalEntry[]
  } catch {
    return [] as JournalEntry[]
  }
}

const mapRowToEntry = (row: JournalEntryRow): JournalEntry => ({
  id: row.id,
  createdAt: row.created_at,
  tradeDate: row.trade_date,
  title: row.title,
  symbol: row.symbol ?? '',
  mood: row.mood,
  tags: row.tags ?? [],
  notes: row.notes
})

export function JournalPage({ trades, userId, selectedAccounts = null }: Props) {
  const [searchParams] = useSearchParams()
  const requestedDate = isDateValue(searchParams.get('date')) ? (searchParams.get('date') as string) : ''
  const today = formatLocalDate(new Date())

  const [loadedTrades, setLoadedTrades] = useState<Trade[]>(trades)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [journalStatus, setJournalStatus] = useState<'syncing' | 'synced' | 'offline'>('syncing')
  const [title, setTitle] = useState('')
  const [symbol, setSymbol] = useState('')
  const [mood, setMood] = useState<JournalEntry['mood']>('focused')
  const [entryDate, setEntryDate] = useState<string>(() => requestedDate || today)
  const [tagsRaw, setTagsRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [entries, setEntries] = useState<JournalEntry[]>([])

  const storageKey = `tradewise-journal-${userId ?? 'anon'}`

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(entries))
  }, [entries, storageKey])

  useEffect(() => {
    const loadJournal = async () => {
      if (!userId) {
        setEntries(readCachedEntries(storageKey))
        setJournalStatus('offline')
        return
      }

      setJournalStatus('syncing')
      const { data, error: journalError } = await supabase
        .from('journal_entries')
        .select('id, created_at, trade_date, title, symbol, mood, tags, notes')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (journalError) {
        setEntries(readCachedEntries(storageKey))
        setJournalStatus('offline')
        const detail = journalError.message ?? journalError.code ?? 'unknown error'
        setError(`Journal cloud sync unavailable (${detail}). Showing locally cached entries.`)
        return
      }

      const mapped = ((data ?? []) as JournalEntryRow[]).map(mapRowToEntry)
      setEntries(mapped)
      setJournalStatus('synced')
    }

    loadJournal()
  }, [userId, storageKey])

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
      if (userId) query = query.eq('user_id', userId)
      if (selectedAccounts && selectedAccounts.length) query = query.in('source_account', selectedAccounts)

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

  const symbolOptions = useMemo(() => {
    const map = new Map<string, number>()
    loadedTrades.forEach((trade) => {
      const key = (trade.ticker || '').toUpperCase()
      if (!key) return
      map.set(key, (map.get(key) ?? 0) + 1)
    })
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map((entry) => entry[0])
  }, [loadedTrades])

  const prompts = useMemo(() => {
    const bySymbol = new Map<string, { count: number; pnl: number; wins: number }>()
    loadedTrades.forEach((trade) => {
      const key = (trade.ticker || 'Unknown').toUpperCase()
      const row = bySymbol.get(key) ?? { count: 0, pnl: 0, wins: 0 }
      row.count += 1
      row.pnl += Number(trade.pnl) || 0
      if ((Number(trade.pnl) || 0) > 0) row.wins += 1
      bySymbol.set(key, row)
    })

    const ranked = Array.from(bySymbol.entries())
      .map(([ticker, row]) => ({
        ticker,
        count: row.count,
        pnl: row.pnl,
        winRate: row.count ? (row.wins / row.count) * 100 : 0
      }))
      .sort((a, b) => b.pnl - a.pnl)

    const best = ranked[0]
    const worst = ranked[ranked.length - 1]

    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, pnl: 0 }))
    loadedTrades.forEach((trade) => {
      const dt = getTradeDate(trade)
      if (!dt) return
      hourly[dt.getHours()].pnl += Number(trade.pnl) || 0
    })
    const bestHour = [...hourly].sort((a, b) => b.pnl - a.pnl)[0]

    const rows = [
      best
        ? `What setup quality makes ${best.ticker} profitable for you? Capture exact entry confirmation and invalidation rules.`
        : 'Document your best setup today: what did price do before you entered?',
      worst
        ? `Review ${worst.ticker}: what repeats before losses? Define one hard filter to avoid low-quality entries.`
        : 'Review your weakest setup and define one concrete filter for tomorrow.',
      bestHour
        ? `Your strongest hour appears to be ${bestHour.hour}:00. Note market context and execution behavior during that hour.`
        : 'Identify your strongest trading hour and log why your decision quality is higher there.',
      'List one mistake pattern from recent trades and one pre-trade checklist item that blocks it.',
      'Write your size plan for the next session: base size, add-on rule, and max daily loss stop.'
    ]

    return rows
  }, [loadedTrades])

  const createEntry = async () => {
    if (!title.trim() || !notes.trim()) return

    const next: JournalEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      tradeDate: entryDate,
      title: title.trim(),
      symbol: symbol.trim().toUpperCase(),
      mood,
      tags: normalizeTagList(tagsRaw),
      notes: notes.trim()
    }

    if (!userId || journalStatus === 'offline') {
      setEntries((prev) => [next, ...prev])
      setJournalStatus('offline')
    } else {
      const { data, error: insertError } = await supabase
        .from('journal_entries')
        .insert({
          user_id: userId,
          trade_date: next.tradeDate,
          title: next.title,
          symbol: next.symbol || null,
          mood: next.mood,
          tags: next.tags,
          notes: next.notes
        })
        .select('id, created_at, trade_date, title, symbol, mood, tags, notes')
        .single()

      if (insertError) {
        setEntries((prev) => [next, ...prev])
        setJournalStatus('offline')
        setError('Could not sync this entry to cloud. Saved locally.')
      } else if (data) {
        const synced = mapRowToEntry(data as JournalEntryRow)
        setEntries((prev) => [synced, ...prev])
        setJournalStatus('synced')
      }
    }

    setTitle('')
    setSymbol('')
    setTagsRaw('')
    setNotes('')
    setMood('focused')
  }

  const removeEntry = async (id: string) => {
    const previous = entries
    setEntries((prev) => prev.filter((entry) => entry.id !== id))

    if (!userId || journalStatus === 'offline') return

    const { error: deleteError } = await supabase.from('journal_entries').delete().eq('id', id).eq('user_id', userId)
    if (deleteError) {
      setEntries(previous)
      setError('Could not delete journal entry from cloud. Nothing was removed.')
    }
  }

  const visibleEntries = useMemo(
    () => (requestedDate ? entries.filter((entry) => entry.tradeDate === requestedDate) : entries),
    [entries, requestedDate]
  )

  return (
    <>
      <PageHeader title="Journal" subtitle="Track your process, emotions, and setup quality" />

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Journal Sync</div>
          <span className={`chip ${journalStatus === 'synced' ? 'filled' : ''}`}>
            {journalStatus === 'synced' ? 'Cloud Synced' : journalStatus === 'syncing' ? 'Syncing…' : 'Offline Cache'}
          </span>
        </div>
        <p className="muted tiny">
          {requestedDate
            ? `Opened from calendar for ${requestedDate}. New entries default to this date.`
            : 'Select a day in Calendar to jump here with that date preselected.'}
        </p>
      </section>

      <div className="grid two journal-grid">
        <section className="panel journal-form-panel">
          <div className="panel-title">New Journal Entry</div>
          <div className="form">
            <label className="label">
              Title
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={requestedDate ? `Review for ${requestedDate}` : 'Example: NQ open drive execution review'}
              />
            </label>

            <label className="label">
              Session Date
              <input className="input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value || today)} />
            </label>

            <div className="journal-form-row">
              <label className="label">
                Symbol
                <input
                  className="input"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder={symbolOptions[0] ? `Try ${symbolOptions[0]}` : 'NQ'}
                  list="journal-symbol-options"
                />
              </label>

              <label className="label">
                Mood
                <div className="select">
                  <select value={mood} onChange={(e) => setMood(e.target.value as JournalEntry['mood'])}>
                    <option value="focused">Focused</option>
                    <option value="confident">Confident</option>
                    <option value="neutral">Neutral</option>
                    <option value="frustrated">Frustrated</option>
                  </select>
                </div>
              </label>
            </div>

            <datalist id="journal-symbol-options">
              {symbolOptions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>

            <label className="label">
              Tags (comma separated)
              <input className="input" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="open-drive, overtrading, risk-control" />
            </label>

            <label className="label">
              Notes
              <textarea
                className="journal-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What did you see, why did you enter, what would you change next time?"
              />
            </label>

            <div className="action-row">
              <button type="button" className="pill-button gradient" onClick={createEntry}>
                Save Entry
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">Suggested Prompts</div>
          <div className="journal-prompts">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                className="journal-prompt"
                type="button"
                onClick={() => {
                  setNotes((prev) => (prev ? `${prev}\n\n${prompt}` : prompt))
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Journal Timeline</div>
          <div className="muted tiny">{visibleEntries.length} entries</div>
        </div>

        {visibleEntries.length ? (
          <div className="journal-list">
            {visibleEntries.map((entry) => (
              <article key={entry.id} className="journal-entry">
                <div className="journal-entry-head">
                  <div>
                    <h3>{entry.title}</h3>
                    <div className="muted tiny">
                      {new Date(entry.createdAt).toLocaleString()} • {entry.tradeDate}
                      {entry.symbol ? ` • ${entry.symbol}` : ''} • {entry.mood}
                    </div>
                  </div>
                  <button className="small-btn danger" type="button" onClick={() => removeEntry(entry.id)}>
                    Delete
                  </button>
                </div>
                {entry.tags.length ? (
                  <div className="journal-tags">
                    {entry.tags.map((tag) => (
                      <span key={`${entry.id}-${tag}`} className="chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p>{entry.notes}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">
            {requestedDate
              ? `No entries for ${requestedDate} yet. Use the form above to add your day review.`
              : 'No entries yet. Use the form above to create your first review note.'}
          </p>
        )}
      </section>

      {error && <div className="muted">Error: {error}</div>}
      {loading && <div className="muted">Loading trades...</div>}
    </>
  )
}
