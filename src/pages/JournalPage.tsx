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

const SETUP_PREFIX = 'setup:'
const MISTAKE_PREFIX = 'mistake:'

const defaultSetups = ['open drive', 'pullback continuation', 'range breakout', 'reversal fade', 'opening range breakout']
const defaultMistakes = [
  'early entry',
  'no stop',
  'oversized',
  'revenge trade',
  'late chase',
  'ignored invalidation',
  'overtrading'
]

const normalizeTagList = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12)

const slugifyLabel = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const prettifySlug = (value: string) =>
  value
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')

const getSetupFromTags = (tags: string[]) => {
  const raw = tags.find((tag) => tag.startsWith(SETUP_PREFIX))
  return raw ? raw.slice(SETUP_PREFIX.length) : ''
}

const getMistakesFromTags = (tags: string[]) =>
  tags.filter((tag) => tag.startsWith(MISTAKE_PREFIX)).map((tag) => tag.slice(MISTAKE_PREFIX.length))

const renderTag = (tag: string) => {
  if (tag.startsWith(SETUP_PREFIX)) return `Setup: ${prettifySlug(tag.slice(SETUP_PREFIX.length))}`
  if (tag.startsWith(MISTAKE_PREFIX)) return `Mistake: ${prettifySlug(tag.slice(MISTAKE_PREFIX.length))}`
  return tag
}

const parseDateValue = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

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
  const [setupName, setSetupName] = useState('')
  const [mistakes, setMistakes] = useState<string[]>([])
  const [tagsRaw, setTagsRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [reviewWeekOffset, setReviewWeekOffset] = useState(0)
  const [copiedReview, setCopiedReview] = useState(false)
  const [sectionOpen, setSectionOpen] = useState({
    sync: false,
    form: true,
    prompts: false,
    scorecards: false,
    review: false,
    timeline: true
  })

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

  const setupOptions = useMemo(() => {
    const dynamic = entries.map((entry) => getSetupFromTags(entry.tags)).filter(Boolean)
    return Array.from(new Set([...defaultSetups, ...dynamic.map((item) => prettifySlug(item))]))
  }, [entries])

  const dayPnlMap = useMemo(() => {
    const map = new Map<string, number>()
    loadedTrades.forEach((trade) => {
      const dt = getTradeDate(trade)
      if (!dt) return
      const key = formatLocalDate(dt)
      map.set(key, (map.get(key) ?? 0) + (Number(trade.pnl) || 0))
    })
    return map
  }, [loadedTrades])

  const playbookRows = useMemo(() => {
    const stats = new Map<string, { count: number; winDays: number; pnlTotal: number }>()
    entries.forEach((entry) => {
      const setup = getSetupFromTags(entry.tags)
      if (!setup) return
      const dayPnl = dayPnlMap.get(entry.tradeDate) ?? 0
      const row = stats.get(setup) ?? { count: 0, winDays: 0, pnlTotal: 0 }
      row.count += 1
      row.pnlTotal += dayPnl
      if (dayPnl > 0) row.winDays += 1
      stats.set(setup, row)
    })

    return Array.from(stats.entries())
      .map(([setup, row]) => ({
        setup,
        count: row.count,
        winRate: row.count ? (row.winDays / row.count) * 100 : 0,
        avgPnl: row.count ? row.pnlTotal / row.count : 0
      }))
      .sort((a, b) => b.avgPnl - a.avgPnl)
  }, [entries, dayPnlMap])

  const mistakeRows = useMemo(() => {
    const stats = new Map<string, { count: number; leakCost: number }>()
    entries.forEach((entry) => {
      const dayPnl = dayPnlMap.get(entry.tradeDate) ?? 0
      const leak = dayPnl < 0 ? Math.abs(dayPnl) : 0
      getMistakesFromTags(entry.tags).forEach((mistake) => {
        const row = stats.get(mistake) ?? { count: 0, leakCost: 0 }
        row.count += 1
        row.leakCost += leak
        stats.set(mistake, row)
      })
    })

    return Array.from(stats.entries())
      .map(([mistake, row]) => ({
        mistake,
        count: row.count,
        leakCost: row.leakCost
      }))
      .sort((a, b) => b.leakCost - a.leakCost)
  }, [entries, dayPnlMap])

  const weeklyReview = useMemo(() => {
    const todayDate = parseDateValue(today)
    if (!todayDate) return null

    const currentStart = addDays(todayDate, -6 - reviewWeekOffset * 7)
    const currentEnd = addDays(todayDate, -reviewWeekOffset * 7)
    const previousStart = addDays(currentStart, -7)
    const previousEnd = addDays(currentStart, -1)

    const inRange = (value: string, start: Date, end: Date) => {
      const dt = parseDateValue(value)
      if (!dt) return false
      return dt >= start && dt <= end
    }

    const currentEntries = entries.filter((entry) => inRange(entry.tradeDate, currentStart, currentEnd))
    const sumPnl = (start: Date, end: Date) => {
      let total = 0
      dayPnlMap.forEach((value, day) => {
        if (inRange(day, start, end)) total += value
      })
      return total
    }

    const currentPnl = sumPnl(currentStart, currentEnd)
    const previousPnl = sumPnl(previousStart, previousEnd)
    const delta = currentPnl - previousPnl

    const setupStats = new Map<string, { count: number; pnl: number }>()
    currentEntries.forEach((entry) => {
      const setup = getSetupFromTags(entry.tags)
      if (!setup) return
      const row = setupStats.get(setup) ?? { count: 0, pnl: 0 }
      row.count += 1
      row.pnl += dayPnlMap.get(entry.tradeDate) ?? 0
      setupStats.set(setup, row)
    })

    const topSetup = Array.from(setupStats.entries())
      .map(([setup, row]) => ({ setup, count: row.count, avgPnl: row.count ? row.pnl / row.count : 0 }))
      .sort((a, b) => b.avgPnl - a.avgPnl)[0]

    const mistakeStats = new Map<string, { count: number; leakCost: number }>()
    currentEntries.forEach((entry) => {
      const dayPnl = dayPnlMap.get(entry.tradeDate) ?? 0
      const leak = dayPnl < 0 ? Math.abs(dayPnl) : 0
      getMistakesFromTags(entry.tags).forEach((mistake) => {
        const row = mistakeStats.get(mistake) ?? { count: 0, leakCost: 0 }
        row.count += 1
        row.leakCost += leak
        mistakeStats.set(mistake, row)
      })
    })

    const topLeak = Array.from(mistakeStats.entries())
      .map(([mistake, row]) => ({ mistake, count: row.count, leakCost: row.leakCost }))
      .sort((a, b) => b.leakCost - a.leakCost)[0]

    const focusRule = topLeak
      ? `If ${prettifySlug(topLeak.mistake)} shows up, cut size by 50% and require a fresh setup confirmation before next trade.`
      : 'Keep size unchanged only when setup criteria are fully met; skip anything borderline.'

    const summary = [
      `Weekly Review (${currentStart.toLocaleDateString()} - ${currentEnd.toLocaleDateString()})`,
      `Net P/L: ${currentPnl >= 0 ? '+' : '-'}$${Math.abs(currentPnl).toFixed(2)} (${delta >= 0 ? '+' : '-'}$${Math.abs(delta).toFixed(2)} vs prior week)`,
      `Journal entries logged: ${currentEntries.length}`,
      topSetup
        ? `Top setup: ${prettifySlug(topSetup.setup)} (${topSetup.count} logs, ${topSetup.avgPnl >= 0 ? '+' : '-'}$${Math.abs(topSetup.avgPnl).toFixed(2)} avg day P/L)`
        : 'Top setup: none tagged this week.',
      topLeak
        ? `Biggest leak: ${prettifySlug(topLeak.mistake)} (${topLeak.count} mentions, $${topLeak.leakCost.toFixed(2)} leak cost)`
        : 'Biggest leak: none tagged this week.',
      `Focus rule for next week: ${focusRule}`
    ].join('\n')

    return {
      currentStart,
      currentEnd,
      currentPnl,
      delta,
      entryCount: currentEntries.length,
      topSetup,
      topLeak,
      focusRule,
      summary
    }
  }, [dayPnlMap, entries, reviewWeekOffset, today])

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

  const persistEntry = async (next: JournalEntry) => {
    if (!userId || journalStatus === 'offline') {
      setEntries((prev) => [next, ...prev])
      setJournalStatus('offline')
      return
    }

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

  const createEntry = async () => {
    if (!title.trim() || !notes.trim()) return

    const setupTag = slugifyLabel(setupName)
    const prefixedMistakes = mistakes.map((mistake) => `${MISTAKE_PREFIX}${slugifyLabel(mistake)}`)
    const userTags = normalizeTagList(tagsRaw).filter(
      (tag) => !tag.startsWith(SETUP_PREFIX) && !tag.startsWith(MISTAKE_PREFIX)
    )
    const mergedTags = [
      ...(setupTag ? [`${SETUP_PREFIX}${setupTag}`] : []),
      ...prefixedMistakes,
      ...userTags
    ].slice(0, 12)

    const next: JournalEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      tradeDate: entryDate,
      title: title.trim(),
      symbol: symbol.trim().toUpperCase(),
      mood,
      tags: mergedTags,
      notes: notes.trim()
    }

    await persistEntry(next)

    setTitle('')
    setSymbol('')
    setSetupName('')
    setMistakes([])
    setTagsRaw('')
    setNotes('')
    setMood('focused')
  }

  const saveWeeklyReview = async () => {
    if (!weeklyReview) return

    const next: JournalEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      tradeDate: formatLocalDate(weeklyReview.currentEnd),
      title: `Weekly Review - ${formatLocalDate(weeklyReview.currentStart)} to ${formatLocalDate(weeklyReview.currentEnd)}`,
      symbol: '',
      mood: 'focused',
      tags: [
        'weekly-review',
        ...(weeklyReview.topSetup ? [`${SETUP_PREFIX}${weeklyReview.topSetup.setup}`] : []),
        ...(weeklyReview.topLeak ? [`${MISTAKE_PREFIX}${weeklyReview.topLeak.mistake}`] : [])
      ],
      notes: weeklyReview.summary
    }

    await persistEntry(next)
  }

  const copyWeeklyReview = async () => {
    if (!weeklyReview) return
    try {
      await navigator.clipboard.writeText(weeklyReview.summary)
      setCopiedReview(true)
      window.setTimeout(() => setCopiedReview(false), 1500)
    } catch {
      setError('Copy failed. Your browser blocked clipboard access.')
    }
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

  const toggleSection = (key: keyof typeof sectionOpen) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <>
      <PageHeader title="Journal" subtitle="Track your process, emotions, and setup quality" />

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Journal Sync</div>
          <div className="panel-header-actions">
            <span className={`chip ${journalStatus === 'synced' ? 'filled' : ''}`}>
              {journalStatus === 'synced' ? 'Cloud Synced' : journalStatus === 'syncing' ? 'Syncing…' : 'Offline Cache'}
            </span>
            <button type="button" className="small-btn" onClick={() => toggleSection('sync')}>
              {sectionOpen.sync ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {sectionOpen.sync ? (
          <p className="muted tiny">
            {requestedDate
              ? `Opened from calendar for ${requestedDate}. New entries default to this date.`
              : 'Select a day in Calendar to jump here with that date preselected.'}
          </p>
        ) : null}
      </section>

      <div className="grid two journal-grid">
        <section className="panel journal-form-panel">
          <div className="panel-header">
            <div className="panel-title">New Journal Entry</div>
            <button type="button" className="small-btn" onClick={() => toggleSection('form')}>
              {sectionOpen.form ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {sectionOpen.form ? <div className="form">
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

            <div className="journal-form-row">
              <label className="label">
                Setup Playbook
                <input
                  className="input"
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                  placeholder="Open Drive"
                  list="journal-setup-options"
                />
              </label>

              <div className="label">
                Mistake Taxonomy
                <div className="journal-mistake-grid">
                  {defaultMistakes.map((item) => {
                    const selected = mistakes.includes(item)
                    return (
                      <button
                        key={item}
                        type="button"
                        className={`chip ${selected ? 'filled' : ''}`}
                        onClick={() =>
                          setMistakes((prev) =>
                            prev.includes(item) ? prev.filter((entry) => entry !== item) : [...prev, item]
                          )
                        }
                      >
                        {item}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <datalist id="journal-setup-options">
              {setupOptions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>

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
          </div> : null}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">Suggested Prompts</div>
            <button type="button" className="small-btn" onClick={() => toggleSection('prompts')}>
              {sectionOpen.prompts ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {sectionOpen.prompts ? <div className="journal-prompts">
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
          </div> : <p className="muted tiny">Expand to see personalized prompts.</p>}
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Process Scorecards</div>
          <div className="panel-header-actions">
            <div className="muted tiny">Setup quality and top leak by mistake</div>
            <button type="button" className="small-btn" onClick={() => toggleSection('scorecards')}>
              {sectionOpen.scorecards ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
        {sectionOpen.scorecards ? <div className="grid two">
          <div className="journal-scorecard">
            <h3>Setup Playbook</h3>
            {playbookRows.length ? (
              <div className="journal-score-rows">
                {playbookRows.slice(0, 6).map((row) => (
                  <div key={row.setup} className="analysis-summary-row">
                    <span>{prettifySlug(row.setup)}</span>
                    <strong>{`${row.count} logs • ${row.winRate.toFixed(0)}% win days • ${row.avgPnl >= 0 ? '+' : '-'}$${Math.abs(row.avgPnl).toFixed(2)} avg`}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Tag entries with a Setup Playbook to start scoring quality.</p>
            )}
          </div>
          <div className="journal-scorecard">
            <h3>Mistake Taxonomy</h3>
            {mistakeRows.length ? (
              <div className="journal-score-rows">
                {mistakeRows.slice(0, 6).map((row) => (
                  <div key={row.mistake} className="analysis-summary-row">
                    <span>{prettifySlug(row.mistake)}</span>
                    <strong>{`${row.count} mentions • $${row.leakCost.toFixed(2)} leak cost`}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Mark mistakes on entries to surface your top leak.</p>
            )}
          </div>
        </div> : <p className="muted tiny">Expand to review setup quality and your most expensive mistakes.</p>}
      </section>

      <section className="panel journal-review-panel">
        <div className="panel-header">
          <div className="panel-title">Weekly Review Auto-Writer</div>
          <div className="journal-review-actions">
            {[0, 1, 2, 3].map((offset) => (
              <button
                key={offset}
                type="button"
                className={`chip ${reviewWeekOffset === offset ? 'filled' : ''}`}
                onClick={() => setReviewWeekOffset(offset)}
              >
                {offset === 0 ? 'This Week' : `${offset}W Ago`}
              </button>
            ))}
            <button
              type="button"
              className="small-btn"
              onClick={() => {
                if (!weeklyReview) return
                setNotes((prev) => (prev ? `${prev}\n\n${weeklyReview.summary}` : weeklyReview.summary))
              }}
            >
              Append To Notes
            </button>
            <button type="button" className="small-btn" onClick={copyWeeklyReview}>
              {copiedReview ? 'Copied' : 'Copy Report'}
            </button>
            <button type="button" className="small-btn" onClick={saveWeeklyReview}>
              Save As Entry
            </button>
            <button type="button" className="small-btn" onClick={() => toggleSection('review')}>
              {sectionOpen.review ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>

        {sectionOpen.review ? weeklyReview ? (
          <div className="journal-review-grid">
            <div className="journal-review-card">
              <span>This Week Net</span>
              <strong>{`${weeklyReview.currentPnl >= 0 ? '+' : '-'}$${Math.abs(weeklyReview.currentPnl).toFixed(2)}`}</strong>
            </div>
            <div className="journal-review-card">
              <span>Change Vs Prior Week</span>
              <strong>{`${weeklyReview.delta >= 0 ? '+' : '-'}$${Math.abs(weeklyReview.delta).toFixed(2)}`}</strong>
            </div>
            <div className="journal-review-card">
              <span>Journal Consistency</span>
              <strong>{`${weeklyReview.entryCount} entries`}</strong>
            </div>
            <div className="journal-review-card journal-review-wide">
              <span>Top Setup</span>
              <strong>
                {weeklyReview.topSetup
                  ? `${prettifySlug(weeklyReview.topSetup.setup)} (${weeklyReview.topSetup.count} logs)`
                  : 'No setup tags this week'}
              </strong>
            </div>
            <div className="journal-review-card journal-review-wide">
              <span>Biggest Leak</span>
              <strong>
                {weeklyReview.topLeak
                  ? `${prettifySlug(weeklyReview.topLeak.mistake)} ($${weeklyReview.topLeak.leakCost.toFixed(2)} leak cost)`
                  : 'No mistakes tagged this week'}
              </strong>
            </div>
            <div className="journal-review-card journal-review-wide">
              <span>Focus Rule</span>
              <strong>{weeklyReview.focusRule}</strong>
            </div>
          </div>
        ) : (
          <p className="muted">Not enough data to generate weekly review.</p>
        ) : <p className="muted tiny">Expand to compare this week against the prior week and generate a review.</p>}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Journal Timeline</div>
          <div className="panel-header-actions">
            <div className="muted tiny">{visibleEntries.length} entries</div>
            <button type="button" className="small-btn" onClick={() => toggleSection('timeline')}>
              {sectionOpen.timeline ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>

        {sectionOpen.timeline ? visibleEntries.length ? (
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
                        {renderTag(tag)}
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
        ) : <p className="muted tiny">Expand to browse saved entries.</p>}
      </section>

      {error && <div className="muted">Error: {error}</div>}
      {loading && <div className="muted">Loading trades...</div>}
    </>
  )
}
