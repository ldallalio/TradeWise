import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { supabase } from '../supabaseClient'
import type { Trade } from '../data/mockData'
import { brokerSchemas } from '../data/brokerSchemas'
import { formatLocalDate, formatLocalTime, getTradeDate } from '../utils/trades'

type Props = {
  userId?: string
}

const brokers = ['Tradovate', 'TradingView', 'Generic CSV Format'] as const

const buildTradovateAuthHelp = (message: string) => {
  if (!/incorrect username or password/i.test(message)) {
    return `Tradovate sync failed: ${message}`
  }

  return [
    'Tradovate rejected the login.',
    'Use your Tradovate login username or email, not the trading account name.',
    'Also verify the environment is correct: Apex/trading accounts are often on Live, not Demo.',
    'If Tradovate requires API access for your account, you may also need an API secret.'
  ].join(' ')
}

type ImportSource = {
  key: string
  accountId: string
  broker: string
  type: string
  details: string
  updated: string
}

type SourceTradeRow = {
  source_account: string | null
  source_broker: string | null
  entry_ts: string | null
}

type ExistingTradeRow = {
  entry_ts: string | null
  ticker: string | null
  side: string | null
  type: string | null
  qty: number | null
  pnl: number | null
  change: string | null
}

type DeleteTradeRow = {
  id: string
}

type InsertTradeRow = {
  user_id: string
  entry_ts: string | null
  side: string | null
  ticker: string | null
  type: string | null
  qty: number | null
  pnl: number | null
  change: string | null
  source_account: string
  source_broker: string
  date: string | null
  time: string | null
  commission: number | null
  fill_price: number | null
  raw_payload: Record<string, unknown> | null
}

const formatTimestamp = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')

const splitCsvLine = (line: string) => {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells
}

const parseUsDateTime = (value?: string | null) => {
  if (!value) return null
  const trimmed = value.trim()
  const match = trimmed.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  )
  if (!match) return null
  const [, monthStr, dayStr, yearStr, hourStr, minuteStr, secondStr] = match
  const month = Number(monthStr)
  const day = Number(dayStr)
  const year = Number(yearStr.length === 2 ? `20${yearStr}` : yearStr)
  const hour = Number(hourStr ?? 0)
  const minute = Number(minuteStr ?? 0)
  const second = Number(secondStr ?? 0)
  const date = new Date(year, month - 1, day, hour, minute, second)
  if (Number.isNaN(date.getTime())) return null
  return date
}

const normalizeDateOnly = (value?: string | null) => {
  if (!value) return ''
  const isoMatch = value.trim().match(/^\d{4}-\d{2}-\d{2}$/)
  if (isoMatch) return value.trim()
  const parsed = parseUsDateTime(value)
  if (parsed) return formatLocalDate(parsed)
  const isoCandidate = new Date(value)
  if (!Number.isNaN(isoCandidate.getTime())) return formatLocalDate(isoCandidate)
  return value
}

const extractTimePart = (value?: string | null) => {
  if (!value) return ''
  const match = value.trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!match) return ''
  const [, hh, mm] = match
  return `${hh.padStart(2, '0')}:${mm}`
}

const parseNumber = (value?: string) => {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

const normalizeSide = (value?: string) => {
  const side = (value || '').toLowerCase()
  if (side === 'buy' || side === 'long') return 'Long'
  if (side === 'sell' || side === 'short') return 'Short'
  return value || ''
}

type ColumnMatcher = string | RegExp | ((key: string) => boolean)

const findColumnValue = (record: Record<string, string>, matchers: ColumnMatcher[]) => {
  const keys = Object.keys(record)
  for (const matcher of matchers) {
    const predicate =
      typeof matcher === 'string'
        ? (key: string) => key === matcher
        : matcher instanceof RegExp
          ? (key: string) => matcher.test(key)
          : matcher
    const foundKey = keys.find(predicate)
    const raw = foundKey ? record[foundKey] : undefined
    if (raw && raw.trim()) {
      return raw.trim()
    }
  }
  return undefined
}

const quantityMatchers: ColumnMatcher[] = [
  'qty',
  'quantity',
  'contracts',
  'shares',
  'size',
  'filledqty',
  'filled_qty',
  (key) => /(^|_)(qty|quantity|contracts?|shares?)($|_)/.test(key)
]

const pnlMatchers: ColumnMatcher[] = [
  'pnl',
  'p_l',
  'pl',
  'net_profit',
  'gross_profit',
  'realized_pnl',
  'realized_pl',
  'net_pnl',
  'pnl_usd',
  'p_l_usd',
  'profit',
  'profit_loss',
  (key) => /(^|_)pnl($|_)/.test(key),
  (key) => /(^|_)p_l($|_)/.test(key),
  (key) => /(^|_)profit($|_)/.test(key)
]

const changeMatchers: ColumnMatcher[] = ['change', 'status', 'result', (key) => key.endsWith('_status')]

const detailFieldCandidates = [
  'details',
  'description',
  'detail',
  'message',
  'note',
  'notes',
  'comment',
  'text',
  'info',
  'summary'
]

const normalizeTickerSymbol = (value?: string) => {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  const upper = trimmed.toUpperCase()
  if (upper.includes('CME_MINI:NQ')) return 'NQ'
  if (upper.startsWith('MNQ')) return 'MNQ'
  if (upper.startsWith('NQ')) return 'NQ'
  return trimmed
}

const getPointValue = (ticker?: string) => {
  if (!ticker) return 1
  const normalized = ticker.toUpperCase()
  if (normalized.includes('CME_MINI:NQ') || normalized === 'NQ' || normalized.startsWith('NQ')) {
    return 20
  }
  if (normalized.startsWith('MNQ')) {
    return 2
  }
  return 1
}

const buildTimestamp = (raw?: string, datePart?: string, timePart?: string) => {
  const candidates = [
    raw,
    datePart && timePart ? `${datePart} ${timePart}` : undefined
  ].filter(Boolean) as string[]
  for (const candidate of candidates) {
    const localParsed = parseUsDateTime(candidate)
    if (localParsed) return localParsed.toISOString()
  }
  const source = raw?.trim() || (datePart && timePart ? `${datePart} ${timePart}` : undefined)
  if (!source) return null
  const trimmed = source.trim()
  const hasT = trimmed.includes('T')
  const isoCandidate = hasT ? trimmed : trimmed.replace(' ', 'T')
  const parsed = new Date(isoCandidate)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

const inferSideFromDetails = (value?: string) => {
  if (!value) return null
  const text = value.toLowerCase()
  const mentionsShort = /(open|close|enter)\s+short\s+position|\bshort position\b/.test(text)
  const mentionsLong = /(open|close|enter)\s+long\s+position|\blong position\b/.test(text)
  if (mentionsShort && !mentionsLong) return 'Short'
  if (mentionsLong && !mentionsShort) return 'Long'
  return null
}

const instructionsByBroker: Record<string, string[]> = {
  'TradingView': [
    'Go to the Trading or Paper Trading tab.',
    'Click the TradingView logo in the top-left corner.',
    'Open History, then choose Export to download the CSV.'
  ],
  Tradovate: [
    'Log into Tradovate.',
    'Navigate to Reports → Account Statements.',
    'Export the statement covering the range you need.'
  ],
  'Generic CSV Format': [
    'Export your broker history as CSV.',
    'Match the file to the generic schema shown below.',
    'Upload the CSV to import trades.'
  ],
  Default: [
    'Log into your broker account.',
    'Export your order or trade history as CSV.',
    'Upload the CSV here to import trades.'
  ]
}

const buildTradeKey = (trade: {
  entry_ts?: string | null
  ticker?: string | null
  side?: string | null
  type?: string | null
  qty?: number | null
  pnl?: number | null
  change?: string | null
}) => {
  const normalize = (value: string | number | null | undefined) =>
    value === null || value === undefined ? '' : typeof value === 'number' ? value.toFixed(4) : value.toLowerCase()
  return [
    normalize(trade.entry_ts ? new Date(trade.entry_ts).toISOString() : ''),
    normalize(trade.ticker),
    normalize(trade.side),
    normalize(trade.type),
    normalize(trade.qty ?? null),
    normalize(trade.pnl ?? null),
    normalize(trade.change)
  ].join('|')
}

export function ImportPage({ userId }: Props) {
  const [sources, setSources] = useState<ImportSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [selectedBroker, setSelectedBroker] = useState<string>(brokers[0])
  const [brokerDropdownOpen, setBrokerDropdownOpen] = useState(false)
  const [brokerSearch, setBrokerSearch] = useState('')
  const [accountName, setAccountName] = useState<string>(brokers[0])
  const [method] = useState('Statement')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(true)
  const [extraFees, setExtraFees] = useState('')
  const [importStartDate, setImportStartDate] = useState('')
  const [deletingSource, setDeletingSource] = useState<string | null>(null)
  const [syncEnvironment, setSyncEnvironment] = useState<'live' | 'demo'>('live')
  const [tradovateUsername, setTradovateUsername] = useState('')
  const [tradovatePassword, setTradovatePassword] = useState('')
  const [tradovateAppId, setTradovateAppId] = useState('TradeWise')
  const [tradovateAppVersion, setTradovateAppVersion] = useState('1.0')
  const [tradovateCid, setTradovateCid] = useState('0')
  const [tradovateSecret, setTradovateSecret] = useState('')
  const [syncBusy, setSyncBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const filteredBrokers = brokers.filter((broker) =>
    broker.toLowerCase().includes(brokerSearch.toLowerCase())
  )

  const loadSources = useCallback(async (uid?: string) => {
    setSourcesLoading(true)
    if (!uid) {
      setSources([])
      setSourcesLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('trades')
      .select('source_account, source_broker, entry_ts')
      .eq('user_id', uid)
      .not('source_account', 'is', null)
    if (error) {
      setStatus('Unable to load import sources.')
      setSourcesLoading(false)
      return
    }
    const rows = (data ?? []) as SourceTradeRow[]
    const grouped = new Map<
      string,
      {
        accountId: string
        broker: string
        latest?: string | null
      }
    >()
    rows.forEach((row) => {
      const accountId = row.source_account
      if (!accountId) return
      const broker = row.source_broker || 'Unknown'
      const key = `${accountId}::${broker}`
      const candidate = row.entry_ts ?? null
      const current = grouped.get(key)
      if (!current) {
        grouped.set(key, { accountId, broker, latest: candidate })
      } else if (candidate && (!current.latest || candidate > current.latest)) {
        current.latest = candidate
      }
    })
    const aggregated = Array.from(grouped.values()).sort((a, b) => {
      if (!a.latest) return 1
      if (!b.latest) return -1
      return b.latest.localeCompare(a.latest)
    })
    setSources(
      aggregated.map((item) => ({
        key: `${item.accountId}::${item.broker}`,
        accountId: item.accountId,
        broker: item.broker,
        type: 'Statement',
        details: `Broker: ${item.broker}`,
        updated: formatTimestamp(item.latest)
      }))
    )
    setSourcesLoading(false)
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadSources(userId)
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [loadSources, userId])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setBrokerDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('mousedown', handleClick)
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setSelectedFile(file ?? null)
  }

  const handleSelectSource = (source: ImportSource) => {
    setSelectedBroker(source.broker)
    setAccountName(source.accountId)
    setStatus(`Ready to import trades into ${source.accountId}. Choose a CSV file.`)
    setSelectedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => {
        fileInputRef.current?.click()
      }, 150)
    }
  }

  const handleDeleteSource = async (source: ImportSource) => {
    if (!userId) {
      setStatus('Please sign in to delete sources.')
      return
    }
    const confirmDelete = window.confirm(`Delete all trades linked to ${source.accountId} (${source.broker})?`)
    if (!confirmDelete) return
    const key = `${source.accountId}::${source.broker}`
    setDeletingSource(key)
    setStatus(`Deleting ${source.accountId} (${source.broker})…`)
    const { data: deletedRows, error } = await supabase
      .from('trades')
      .delete()
      .match({ user_id: userId, source_account: source.accountId, source_broker: source.broker })
      .select('id')
    if (error) {
      setStatus(`Unable to delete ${source.accountId}: ${error.message}`)
      setDeletingSource(null)
      return
    }
    const deleted = (deletedRows ?? []) as DeleteTradeRow[]
    if (!deleted.length) {
      setStatus(`No trades found for ${source.accountId} (${source.broker}).`)
      setDeletingSource(null)
      await loadSources(userId)
      return
    }
    setStatus(`Deleted ${deleted.length} trades for ${source.accountId} (${source.broker}).`)
    setSources((prev) => prev.filter((item) => item.key !== key))
    await loadSources(userId)
    setDeletingSource(null)
  }

  const handleTradovateSync = async () => {
    if (!userId) {
      setStatus('Please sign in to sync Tradovate.')
      return
    }
    if (!tradovateUsername.trim() || !tradovatePassword) {
      setStatus('Tradovate username and password are required to sync.')
      return
    }

    setSyncBusy(true)
    setStatus('Syncing Tradovate fills…')

    const { data, error } = await supabase.functions.invoke<{
      insertedCount: number
      skippedCount: number
      accountSummaries: Array<{ accountName: string; imported: number; skipped: number }>
    }>('tradovate-sync', {
      body: {
        environment: syncEnvironment,
        name: tradovateUsername.trim(),
        password: tradovatePassword,
        appId: tradovateAppId.trim() || 'TradeWise',
        appVersion: tradovateAppVersion.trim() || '1.0',
        cid: tradovateCid.trim() || '0',
        sec: tradovateSecret.trim() || undefined,
        importStartDate: importStartDate || undefined
      }
    })

    if (error) {
      setStatus(buildTradovateAuthHelp(error.message))
      setSyncBusy(false)
      return
    }

    const summary = data?.accountSummaries.length
      ? data.accountSummaries.map((item) => `${item.accountName}: ${item.imported} imported`).join(' | ')
      : 'No account data returned.'
    setStatus(
      `Tradovate sync complete. Imported ${data?.insertedCount ?? 0} trades, skipped ${data?.skippedCount ?? 0}. ${summary}`
    )
    await loadSources(userId)
    setSyncBusy(false)
  }

type ParsedCsvRow = {
  trade: Partial<Trade>
  meta: {
    side: string
    qty?: number
    fillPrice?: number | null
    feePerUnit: number
    totalFee: number
    pointValue: number
    isTradovateFilled?: boolean
    closedQty?: number
  }
}

type Lot = { qty: number; price: number; feePerUnit: number; multiplier: number }
type OpenLot = { qty: number; price: number; multiplier: number; openedAt: string | null }

const buildTradovateClosedTrades = (rows: ParsedCsvRow[]): Partial<Trade>[] => {
  const longLots = new Map<string, OpenLot[]>()
  const shortLots = new Map<string, OpenLot[]>()
  const ordered = [...rows].sort((a, b) => getTradeTimestamp(a.trade) - getTradeTimestamp(b.trade))
  const closedTrades: Partial<Trade>[] = []

  for (const row of ordered) {
    const ticker = row.trade.ticker
    const side = row.meta.side.toLowerCase()
    const qty = row.meta.qty
    const fillPrice = row.meta.fillPrice
    if (!ticker || !qty || fillPrice === undefined || fillPrice === null) continue

    const multiplier = row.meta.pointValue || 1
    let remaining = qty

    if (side === 'buy' || side === 'long') {
      const shortQueue = shortLots.get(ticker) ?? []
      while (remaining > 0 && shortQueue.length) {
        const lot = shortQueue[0]
        const matched = Math.min(remaining, lot.qty)
        const pnl = (lot.price - fillPrice) * matched * lot.multiplier
        closedTrades.push({
          ...row.trade,
          side: 'Short',
          qty: matched,
          pnl,
          type: 'Future',
          fill_price: fillPrice,
          raw_payload: {
            ...(row.trade.raw_payload ?? {}),
            _matched_open_ts: lot.openedAt,
            _matched_open_price: lot.price,
            _matched_close_price: fillPrice,
            _matched_qty: matched
          }
        })
        lot.qty -= matched
        remaining -= matched
        if (lot.qty <= 1e-8) shortQueue.shift()
      }
      if (shortQueue.length) {
        shortLots.set(ticker, shortQueue.filter((lot) => lot.qty > 0))
      } else {
        shortLots.delete(ticker)
      }
      if (remaining > 0) {
        const lots = longLots.get(ticker) ?? []
        lots.push({ qty: remaining, price: fillPrice, multiplier, openedAt: row.trade.entry_ts ?? null })
        longLots.set(ticker, lots)
      }
      continue
    }

    if (side === 'sell' || side === 'short') {
      const longQueue = longLots.get(ticker) ?? []
      while (remaining > 0 && longQueue.length) {
        const lot = longQueue[0]
        const matched = Math.min(remaining, lot.qty)
        const pnl = (fillPrice - lot.price) * matched * lot.multiplier
        closedTrades.push({
          ...row.trade,
          side: 'Long',
          qty: matched,
          pnl,
          type: 'Future',
          fill_price: fillPrice,
          raw_payload: {
            ...(row.trade.raw_payload ?? {}),
            _matched_open_ts: lot.openedAt,
            _matched_open_price: lot.price,
            _matched_close_price: fillPrice,
            _matched_qty: matched
          }
        })
        lot.qty -= matched
        remaining -= matched
        if (lot.qty <= 1e-8) longQueue.shift()
      }
      if (longQueue.length) {
        longLots.set(ticker, longQueue.filter((lot) => lot.qty > 0))
      } else {
        longLots.delete(ticker)
      }
      if (remaining > 0) {
        const lots = shortLots.get(ticker) ?? []
        lots.push({ qty: remaining, price: fillPrice, multiplier, openedAt: row.trade.entry_ts ?? null })
        shortLots.set(ticker, lots)
      }
    }
  }

  return closedTrades
}

const closeLots = (lots: Lot[], qty: number, exitPrice: number, closingLong: boolean) => {
  let realized = 0
  let remaining = qty
  while (remaining > 0 && lots.length) {
    const lot = lots[0]
    const matched = Math.min(remaining, lot.qty)
    const priceDelta = closingLong ? exitPrice - lot.price : lot.price - exitPrice
    realized += priceDelta * matched * (lot.multiplier || 1) - lot.feePerUnit * matched
    lot.qty -= matched
    if (lot.qty <= 1e-8) {
      lots.shift()
    }
    remaining -= matched
  }
  return { realized, remaining }
}

const getTradeTimestamp = (trade: Partial<Trade>) => {
  return getTradeDate(trade)?.getTime() ?? 0
}

const deriveFifoPnl = (rows: ParsedCsvRow[]) => {
  const longLots = new Map<string, Lot[]>()
  const shortLots = new Map<string, Lot[]>()
  const ordered = [...rows].sort((a, b) => {
    return getTradeTimestamp(a.trade) - getTradeTimestamp(b.trade)
  })
  ordered.forEach((row) => {
    row.meta.closedQty = 0
    if (typeof row.trade.pnl === 'number') return
    const ticker = row.trade.ticker
    const qty = row.meta.qty
    const price = row.meta.fillPrice
    if (!ticker || !qty || price === undefined || price === null) {
      if (row.trade.pnl === undefined) row.trade.pnl = 0
      return
    }
    const totalFee = row.meta.totalFee || 0
    const qtyTotal = qty ?? 0
    const feePerUnit = qtyTotal ? totalFee / qtyTotal : row.meta.feePerUnit || 0
    const pointValue = row.meta.pointValue || 1
    const normalizedSide = row.meta.side.toLowerCase()
    let realized = 0
    let closedQty = 0
    if (normalizedSide === 'long' || normalizedSide === 'buy') {
      const shortQueue = shortLots.get(ticker) ?? []
      const { realized: realizedClose, remaining } = closeLots(shortQueue, qty, price, false)
      realized += realizedClose
      closedQty = qty - remaining
      if (remaining > 0) {
        const lotList = longLots.get(ticker) ?? []
        lotList.push({ qty: remaining, price, feePerUnit, multiplier: pointValue })
        longLots.set(ticker, lotList)
      }
      if (shortQueue.length) {
        shortLots.set(ticker, shortQueue.filter((lot) => lot.qty > 0))
      } else {
        shortLots.delete(ticker)
      }
    } else if (normalizedSide === 'short' || normalizedSide === 'sell') {
      const longQueue = longLots.get(ticker) ?? []
      const { realized: realizedClose, remaining } = closeLots(longQueue, qty, price, true)
      realized += realizedClose
      closedQty = qty - remaining
      if (remaining > 0) {
        const lotList = shortLots.get(ticker) ?? []
        lotList.push({ qty: remaining, price, feePerUnit, multiplier: pointValue })
        shortLots.set(ticker, lotList)
      }
      if (longQueue.length) {
        longLots.set(ticker, longQueue.filter((lot) => lot.qty > 0))
      } else {
        longLots.delete(ticker)
      }
    }
    if (closedQty > 0) {
      const feeShare = qtyTotal ? totalFee * (closedQty / qtyTotal) : totalFee
      row.trade.pnl = realized - feeShare
      row.meta.closedQty = closedQty
    } else if (row.trade.pnl === undefined) {
      row.trade.pnl = 0
    }
  })
}

const parseCsv = (text: string, broker: string): Partial<Trade>[] => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const rawHeaders = splitCsvLine(lines[0]).map(normalizeHeader)
  const rows = lines.slice(1)
  const mappedRows: ParsedCsvRow[] = rows
    .map((row) => {
      const cols = splitCsvLine(row)
      const record: Record<string, string> = {}
      rawHeaders.forEach((h, idx) => {
        record[h] = cols[idx]?.trim() ?? ''
      })
      const entryTs =
        buildTimestamp(record.entry_ts) ||
        buildTimestamp(record.timestamp) ||
        buildTimestamp(record.fill_time) ||
        buildTimestamp(record.closing_time) ||
        buildTimestamp(record.placing_time) ||
        buildTimestamp(record.close_time) ||
        buildTimestamp(record.open_time) ||
        buildTimestamp(record.trade_time) ||
        buildTimestamp(record.date, record.time)
      const qty = parseNumber(findColumnValue(record, quantityMatchers))
      const filledQty = parseNumber(
        record.filled_qty ||
          record.filledqty ||
          record.fill_qty ||
          record.filled_quantity ||
          record.executed_qty
      )
      const pnlRaw = findColumnValue(record, pnlMatchers) ?? record.change ?? record.status
      const pnl = parseNumber(pnlRaw)
      const rawTicker =
        record.ticker || record.symbol || record.instrument || record.product || record.contract || record.product_description || ''
      const ticker = normalizeTickerSymbol(rawTicker)
      const detailSource = detailFieldCandidates
        .map((key) => record[key])
        .find((value): value is string => Boolean(value && value.trim()))
      const inferredSide = inferSideFromDetails(detailSource?.trim())
      const side = inferredSide ?? normalizeSide(record.side || record.b_s || record.buy_sell || record.order_action)
      const fillPrice = parseNumber(
        record.fill_price ||
          record.fillprice ||
          record.price ||
          record.execution_price ||
          record._price ||
          record.avgprice ||
          record.avg_fill_price ||
          record.decimalfillavg
      )
      const commissionValue = parseNumber(
        record.commission ||
          record.commissions ||
          record.total_commission ||
          record.total_commissions ||
          record.total_fee ||
          record.total_fees ||
          record.fee ||
          record.fees
      )
      const entryDate = entryTs ? new Date(entryTs) : null
      const qtyValue = typeof qty === 'number' ? Math.abs(qty) : undefined
      const pnlValue = typeof pnl === 'number' ? pnl : undefined
      const changeValue = findColumnValue(record, changeMatchers) ?? ''
      const normalizedStatus = changeValue.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')
      const isTradovateFilled =
        broker !== 'Tradovate' ||
        ((normalizedStatus.includes('fill') || normalizedStatus.includes('execut')) &&
          typeof fillPrice === 'number' &&
          ((typeof filledQty === 'number' && filledQty > 0) || (typeof qtyValue === 'number' && qtyValue > 0)))
      const pointValue = getPointValue(ticker)
      const fallbackTimeSource =
        record.timestamp ||
        record.fill_time ||
        record.filltime ||
        record.closing_time ||
        record.fill_time ||
        record.time ||
        ''
      const parsedDateFromSource = normalizeDateOnly(record.date || fallbackTimeSource)
      const parsedTimeFromSource = extractTimePart(fallbackTimeSource)
      const normalizedDate = parsedDateFromSource || (entryDate ? formatLocalDate(entryDate) : '')
      const normalizedTime = parsedTimeFromSource || (entryDate ? formatLocalTime(entryDate) : record.time || '')
      const trade: Partial<Trade> = {
        entry_ts: entryTs,
        date: normalizedDate,
        time: normalizedTime,
        side,
        type: broker === 'Tradovate' ? 'Future' : record.type || record.asset_type || record.product || '',
        ticker,
        qty: qtyValue,
        pnl: pnlValue,
        change: changeValue,
        commission: commissionValue ?? null,
        fill_price: fillPrice ?? null,
        raw_payload: {
          ...record,
          _parsed_entry_ts: entryTs ?? null,
          _parsed_time: normalizedTime || null,
          _parsed_date: normalizedDate || null,
          _parsed_qty: qtyValue ?? null,
          _parsed_fill_price: fillPrice ?? null,
          _parsed_commission: commissionValue ?? null
        }
      }
      return {
        trade,
        meta: {
          side,
          qty: qtyValue,
          fillPrice,
          feePerUnit: qtyValue && commissionValue ? commissionValue / qtyValue : 0,
          totalFee: commissionValue || 0,
          pointValue,
          isTradovateFilled,
          closedQty: 0
        }
      }
    })
    .filter(
      (row) =>
        Boolean(row.trade.entry_ts || row.trade.ticker || row.trade.side || row.trade.type || row.trade.change) ||
        row.trade.qty !== undefined ||
        row.trade.pnl !== undefined
    )
      .filter((row) => row.meta.isTradovateFilled !== false)
  if (broker === 'TradingView' || broker === 'Tradovate') {
    deriveFifoPnl(mappedRows)
  }

  if (broker === 'Tradovate') {
    return buildTradovateClosedTrades(mappedRows)
  }

  return mappedRows.map((row) => row.trade)
}

const stripOptionalColumns = <T extends Record<string, unknown>>(rows: T[]) => {
  const optionalKeys = ['raw_payload', 'commission', 'fill_price']
  return rows.map((row) => {
    const clone = { ...row }
    optionalKeys.forEach((key) => {
      if (key in clone) {
        delete clone[key]
      }
    })
    return clone as T
  })
}

const stripDateTimeColumns = <T extends Record<string, unknown>>(rows: T[]) =>
  rows.map((row) => {
    const clone = { ...row }
    delete clone.date
    delete clone.time
    return clone as T
  })

  const handleImport = async () => {
    const finalizeSuccess = async (message: string) => {
      setStatus(message)
      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      await loadSources(userId)
    }
    if (!userId) {
      setStatus('Please sign in to import.')
      return
    }
    if (!selectedFile) {
      setStatus('Choose a CSV file first.')
      return
    }
    const trimmedAccount = accountName.trim()
    if (!trimmedAccount) {
      setStatus('Add an account name to track this source.')
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      const text = await selectedFile.text()
      const parsed = parseCsv(text, selectedBroker).filter((r) => r)
      if (!parsed.length) {
        setStatus('No rows found in CSV.')
        setBusy(false)
        return
      }
      const earliest = importStartDate ? new Date(importStartDate) : null
      const filteredRows = earliest
        ? parsed.filter((r) => {
            if (!r.entry_ts) return true
            const ts = new Date(r.entry_ts)
            if (Number.isNaN(ts.getTime())) return true
            return ts >= earliest
          })
        : parsed
      if (!filteredRows.length) {
        setStatus('No rows match the filters provided.')
        setBusy(false)
        return
      }
      const { data: existingTrades, error: existingError } = await supabase
        .from('trades')
        .select('entry_ts,ticker,side,type,qty,pnl,change')
        .match({ user_id: userId, source_account: trimmedAccount, source_broker: selectedBroker })
      if (existingError) {
        setStatus(`Unable to check existing trades: ${existingError.message}`)
        setBusy(false)
        return
      }
      const existingRows = (existingTrades ?? []) as ExistingTradeRow[]
      const existingKeys = new Set(
        existingRows.map((trade) =>
          buildTradeKey({
            entry_ts: trade.entry_ts,
            ticker: trade.ticker,
            side: trade.side,
            type: trade.type,
            qty: trade.qty,
            pnl: trade.pnl,
            change: trade.change
          })
        ) ?? []
      )
      const feeValue = Number(extraFees) || 0
      const rows = filteredRows
        .map((r) => {
          const qtyValue = typeof r.qty === 'number' ? r.qty : null
          const pnlValue = typeof r.pnl === 'number' ? r.pnl : null
          const isFuture = selectedBroker === 'Tradovate' || (r.type || '').toLowerCase().includes('future')
          const feeAdjustment = feeValue && qtyValue ? feeValue * Math.abs(qtyValue) : 0
          const adjustedPnl = pnlValue !== null && isFuture && feeAdjustment ? pnlValue - feeAdjustment : pnlValue
          const payload = {
            user_id: userId,
            entry_ts: r.entry_ts || null,
            side: r.side || null,
            ticker: r.ticker || null,
            type: r.type || null,
            qty: qtyValue,
            pnl: adjustedPnl,
            change: r.change ?? null,
            source_account: trimmedAccount,
            source_broker: selectedBroker,
            date: r.date || null,
            time: r.time || null,
            commission: r.commission ?? null,
            fill_price: r.fill_price ?? null,
            raw_payload: r.raw_payload ?? null
          }
          const key = buildTradeKey(payload)
          if (existingKeys.has(key)) {
            return null
          }
          existingKeys.add(key)
          return payload
        })
        .filter((row): row is InsertTradeRow => row !== null)
      if (!rows.length) {
        setStatus('All trades in this CSV already exist for this account.')
        setBusy(false)
        return
      }
      const { error } = await supabase.from('trades').insert(rows)
      if (error) {
        const leanRows = stripOptionalColumns(rows)
        const { error: leanError } = await supabase.from('trades').insert(leanRows)
        if (leanError) {
          const leanRowsNoDateTime = stripDateTimeColumns(leanRows)
          const { error: minimalError } = await supabase.from('trades').insert(leanRowsNoDateTime)
          if (minimalError) {
            setStatus(`Import failed: ${minimalError.message}`)
          } else {
            await finalizeSuccess(
              `Imported ${leanRowsNoDateTime.length} trades into ${trimmedAccount}. Date/time and optional broker fields were skipped because those columns are missing in the trades table.`
            )
          }
        } else {
          await finalizeSuccess(
            `Imported ${leanRows.length} trades into ${trimmedAccount}. Optional fields (commission/fill_price/raw_payload) were skipped because the trades table is missing those columns.`
          )
        }
      } else {
        await finalizeSuccess(`Imported ${rows.length} trades into ${trimmedAccount}.`)
      }
    } catch (err) {
      setStatus(`Import failed: ${(err as Error).message}`)
    }
    setBusy(false)
  }

  const instructionSteps = instructionsByBroker[selectedBroker] ?? instructionsByBroker.Default
  const selectedSchema = brokerSchemas[selectedBroker] ?? brokerSchemas.Default

  return (
    <>
      <PageHeader title="Import" subtitle="Upload broker statements to add trades" />

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Your Import Sources</div>
        </div>
        <div className="table-body">
          <div className="table-head">
            <span>Account ID</span>
            <span>Type</span>
            <span>Details</span>
            <span>Last Updated</span>
            <span>Actions</span>
          </div>
          {sourcesLoading ? (
            <div className="table-row">
              <span className="muted">Loading sources…</span>
            </div>
          ) : sources.length ? (
            sources.map((source) => (
              <div key={source.key} className="table-row">
                <span>{source.accountId}</span>
                <span className="pill slate">{source.type}</span>
                <span className="muted">{source.details}</span>
                <span className="muted tiny">{source.updated}</span>
                <span className="action-row">
                  <button className="small-btn" type="button" onClick={() => handleSelectSource(source)}>
                    Add Statement
                  </button>
                  <button
                    className="small-btn danger"
                    type="button"
                    onClick={() => handleDeleteSource(source)}
                    disabled={deletingSource === source.key}
                  >
                    {deletingSource === source.key ? 'Deleting…' : 'Delete'}
                  </button>
                </span>
              </div>
            ))
          ) : (
            <div className="table-row">
              <span className="muted">No sources yet. Add your first import below.</span>
            </div>
          )}
        </div>
      </section>

      <section className="panel import-panel">
        <div className="panel-title">Add New Import Source</div>
        <div className="broker-select" ref={dropdownRef}>
          <button className="select-button" type="button" onClick={() => setBrokerDropdownOpen((open) => !open)}>
            <span>{selectedBroker}</span>
            <span className={`chevron ${brokerDropdownOpen ? 'open' : ''}`}>▾</span>
          </button>
          {brokerDropdownOpen && (
            <div className="broker-dropdown">
              <input
                className="broker-search"
                placeholder="Search broker..."
                value={brokerSearch}
                onChange={(e) => setBrokerSearch(e.target.value)}
                autoFocus
              />
              <div className="broker-options">
                {filteredBrokers.map((broker) => (
                  <button
                    key={broker}
                    className="broker-option"
                    type="button"
                    onClick={() => {
                      setSelectedBroker(broker)
                      setBrokerDropdownOpen(false)
                      setBrokerSearch('')
                    }}
                  >
                    {broker}
                  </button>
                ))}
                {!filteredBrokers.length && <div className="muted small">No matches.</div>}
              </div>
            </div>
          )}
        </div>

        <div className="label">Select import method</div>
        <div className="chip-row">
          <button className="tab filled" type="button">
            {method}
          </button>
        </div>

        {selectedBroker === 'Tradovate' && (
          <div className="schema-card">
            <div className="schema-card-header">
              <div>
                <div className="label">Tradovate Direct Sync</div>
                <div className="tiny muted">Credentials are sent only to your Supabase edge function for this sync request.</div>
              </div>
            </div>
            <div className="advanced-grid">
              <label className="input-group">
                <span className="label">Environment</span>
                <select
                  className="input"
                  value={syncEnvironment}
                  onChange={(e) => setSyncEnvironment(e.target.value as 'live' | 'demo')}
                >
                  <option value="live">Live</option>
                  <option value="demo">Demo</option>
                </select>
                <span className="tiny muted">Use the same environment you log into in Tradovate. Prop accounts are commonly on Live.</span>
              </label>
              <label className="input-group">
                <span className="label">Tradovate Username</span>
                <input
                  className="input"
                  type="text"
                  value={tradovateUsername}
                  onChange={(e) => setTradovateUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="Your Tradovate login username or email"
                />
                <span className="tiny muted">Enter the actual Tradovate login, not the account name shown in the platform.</span>
              </label>
              <label className="input-group">
                <span className="label">Tradovate Password</span>
                <input
                  className="input"
                  type="password"
                  value={tradovatePassword}
                  onChange={(e) => setTradovatePassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <label className="input-group">
                <span className="label">API Secret</span>
                <input
                  className="input"
                  type="password"
                  value={tradovateSecret}
                  onChange={(e) => setTradovateSecret(e.target.value)}
                  placeholder="Optional"
                />
                <span className="tiny muted">Leave this empty if your Tradovate login works without an API secret.</span>
              </label>
              <label className="input-group">
                <span className="label">App ID</span>
                <input
                  className="input"
                  type="text"
                  value={tradovateAppId}
                  onChange={(e) => setTradovateAppId(e.target.value)}
                />
              </label>
              <label className="input-group">
                <span className="label">App Version</span>
                <input
                  className="input"
                  type="text"
                  value={tradovateAppVersion}
                  onChange={(e) => setTradovateAppVersion(e.target.value)}
                />
              </label>
              <label className="input-group">
                <span className="label">CID</span>
                <input
                  className="input"
                  type="text"
                  value={tradovateCid}
                  onChange={(e) => setTradovateCid(e.target.value)}
                />
              </label>
            </div>
            <div className="center" style={{ marginTop: 20 }}>
              <button className="pill-button gradient" type="button" onClick={handleTradovateSync} disabled={syncBusy}>
                {syncBusy ? 'Syncing…' : 'Sync From Tradovate'}
              </button>
            </div>
          </div>
        )}

        <div className="label">Statement Import</div>
        <div className="instructions">
          <div className="instructions-title">Instructions</div>
          <div className="instructions-subtitle">Steps:</div>
          <ul>
            {instructionSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
        <div className="schema-card">
          <div className="schema-card-header">
            <div>
              <div className="label">CSV Schema</div>
              {selectedSchema.filePattern && (
                <div className="tiny muted">Example file name: {selectedSchema.filePattern}</div>
              )}
            </div>
          </div>
          {selectedSchema.notes && <p className="tiny muted">{selectedSchema.notes}</p>}
          {selectedSchema.columns.length ? (
            <div className="schema-table">
              <div className="schema-head">
                <span>Column</span>
                <span>Required</span>
                <span>Maps To</span>
                <span>Description</span>
                <span>Example</span>
              </div>
              {selectedSchema.columns.map((column) => (
                <div key={column.label} className="schema-row">
                  <span>{column.label}</span>
                  <span className="schema-required">{column.required ? 'Required' : 'Optional'}</span>
                  <span className="schema-maps">{column.mapsTo ?? '—'}</span>
                  <span className="muted">{column.description}</span>
                  <span className="schema-sample">{column.sample ?? '—'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="tiny muted">No schema defined yet. Use the Generic CSV format for best results.</div>
          )}
        </div>

        <div className="upload-box large">
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} />
          <div>{selectedFile ? selectedFile.name : 'Drag n drop a file here, or click to select a file'}</div>
        </div>

        <button className="advanced-toggle" type="button" onClick={() => setShowAdvanced((prev) => !prev)}>
          <span>Advanced Options</span>
          <span className={`chevron ${showAdvanced ? 'open' : ''}`}>▾</span>
        </button>
        {showAdvanced && (
          <div className="advanced-grid">
            <label className="input-group">
              <span className="label">Account</span>
              <input
                className="input"
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Account label"
              />
            </label>
            <label className="input-group">
              <span className="label">Extra fees per futures contract</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={extraFees}
                onChange={(e) => setExtraFees(e.target.value)}
                placeholder="0.00"
              />
              <span className="tiny muted">
                These fees apply only to futures trades and are calculated per side based on contracts.
              </span>
            </label>
            <label className="input-group">
              <span className="label">Import data starting from</span>
              <input
                className="input"
                type="date"
                value={importStartDate}
                onChange={(e) => setImportStartDate(e.target.value)}
              />
            </label>
          </div>
        )}

        <div className="center" style={{ marginTop: 20 }}>
          <button className="pill-button gradient" type="button" onClick={handleImport} disabled={busy}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>

        {status && <div className="muted" style={{ marginTop: 12 }}>{status}</div>}
      </section>

      <section className="panel subtle">
        <div className="panel-title">Can't Find Your Broker?</div>
        <p className="muted">
          We're constantly expanding broker support. Send us a message or submit a feature request and we'll typically add
          CSV import support for new brokers within a week.
        </p>
      </section>
    </>
  )
}
