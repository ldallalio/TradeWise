import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const tradovateBaseUrls = {
  live: 'https://live.tradovateapi.com/v1',
  demo: 'https://demo.tradovateapi.com/v1'
} as const

const buildAuthErrorMessage = (environment: 'live' | 'demo', message: string) => {
  if (!/incorrect username or password/i.test(message)) {
    return message
  }

  return [
    'Tradovate rejected the login.',
    'Make sure you are using your Tradovate login username or email, not the account name.',
    `Current environment: ${environment}. If this is the wrong environment, switch between Live and Demo.`,
    'Some Tradovate accounts also require API access or an API secret even when the website password is correct.'
  ].join(' ')
}

type SyncRequest = {
  environment?: keyof typeof tradovateBaseUrls
  name?: string
  password?: string
  appId?: string
  appVersion?: string
  cid?: string
  sec?: string
  importStartDate?: string
}

type AccountEntity = {
  id: number
  name: string
  active?: boolean
}

type OrderEntity = {
  id?: number
  orderId?: number
}

type FillEntity = {
  id?: number
  orderId: number
  contractId: number
  timestamp: string
  action: 'Buy' | 'Sell'
  qty: number
  price: number
}

type ContractEntity = {
  id: number
  name: string
}

type ExistingTradeRow = {
  source_account: string | null
  entry_ts: string | null
  ticker: string | null
  side: string | null
  type: string | null
  qty: number | null
  pnl: number | null
  change: string | null
}

type InsertTradeRow = {
  user_id: string
  entry_ts: string | null
  date: string | null
  time: string | null
  side: string | null
  type: string | null
  ticker: string | null
  qty: number | null
  pnl: number | null
  change: string | null
  source_account: string
  source_broker: string
  commission: number | null
  fill_price: number | null
  raw_payload: Record<string, unknown> | null
}

type DerivedTrade = {
  sourceAccount: string
  entryTs: string
  side: 'Long' | 'Short'
  ticker: string
  qty: number
  pnl: number
  fillPrice: number
  rawPayload: Record<string, unknown>
}

type Lot = {
  qty: number
  price: number
  multiplier: number
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  })

const chunk = <T>(values: T[], size: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

const formatDatePart = (value: Date) => {
  const year = value.getUTCFullYear()
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${value.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatTimePart = (value: Date) => {
  const hours = `${value.getUTCHours()}`.padStart(2, '0')
  const minutes = `${value.getUTCMinutes()}`.padStart(2, '0')
  return `${hours}:${minutes}`
}

const getPointValue = (ticker: string) => {
  const normalized = ticker.toUpperCase()
  if (normalized.startsWith('NQ')) return 20
  if (normalized.startsWith('MNQ')) return 2
  return 1
}

const closeLots = (lots: Lot[], qty: number, exitPrice: number, closingLong: boolean) => {
  let realized = 0
  let remaining = qty
  while (remaining > 0 && lots.length) {
    const lot = lots[0]
    const matched = Math.min(remaining, lot.qty)
    const priceDelta = closingLong ? exitPrice - lot.price : lot.price - exitPrice
    realized += priceDelta * matched * lot.multiplier
    lot.qty -= matched
    if (lot.qty <= 1e-8) {
      lots.shift()
    }
    remaining -= matched
  }
  return { realized, remaining }
}

const derivePnls = (fills: DerivedTrade[]) => {
  const longLots = new Map<string, Lot[]>()
  const shortLots = new Map<string, Lot[]>()
  const ordered = [...fills].sort((left, right) => new Date(left.entryTs).getTime() - new Date(right.entryTs).getTime())

  for (const trade of ordered) {
    const ticker = trade.ticker
    const pointValue = getPointValue(ticker)
    let realized = 0
    let closedQty = 0

    if (trade.side === 'Long') {
      const shortQueue = shortLots.get(ticker) ?? []
      const { realized: closeRealized, remaining } = closeLots(shortQueue, trade.qty, trade.fillPrice, false)
      realized += closeRealized
      closedQty = trade.qty - remaining
      if (remaining > 0) {
        const lots = longLots.get(ticker) ?? []
        lots.push({ qty: remaining, price: trade.fillPrice, multiplier: pointValue })
        longLots.set(ticker, lots)
      }
      if (shortQueue.length) {
        shortLots.set(ticker, shortQueue.filter((lot) => lot.qty > 0))
      } else {
        shortLots.delete(ticker)
      }
    } else {
      const longQueue = longLots.get(ticker) ?? []
      const { realized: closeRealized, remaining } = closeLots(longQueue, trade.qty, trade.fillPrice, true)
      realized += closeRealized
      closedQty = trade.qty - remaining
      if (remaining > 0) {
        const lots = shortLots.get(ticker) ?? []
        lots.push({ qty: remaining, price: trade.fillPrice, multiplier: pointValue })
        shortLots.set(ticker, lots)
      }
      if (longQueue.length) {
        longLots.set(ticker, longQueue.filter((lot) => lot.qty > 0))
      } else {
        longLots.delete(ticker)
      }
    }

    trade.pnl = closedQty > 0 ? realized : 0
  }

  return ordered
}

const buildTradeKey = (trade: {
  sourceAccount: string
  entryTs: string | null
  ticker: string | null
  side: string | null
  type: string | null
  qty: number | null
  pnl: number | null
  change: string | null
}) => {
  const normalize = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'number') return value.toFixed(4)
    return value.toLowerCase()
  }

  return [
    normalize(trade.sourceAccount),
    normalize(trade.entryTs ? new Date(trade.entryTs).toISOString() : ''),
    normalize(trade.ticker),
    normalize(trade.side),
    normalize(trade.type),
    normalize(trade.qty),
    normalize(trade.pnl),
    normalize(trade.change)
  ].join('|')
}

const stripOptionalColumns = <T extends Record<string, unknown>>(rows: T[]) =>
  rows.map((row) => {
    const clone = { ...row }
    delete clone.raw_payload
    delete clone.commission
    delete clone.fill_price
    return clone as T
  })

const stripDateTimeColumns = <T extends Record<string, unknown>>(rows: T[]) =>
  rows.map((row) => {
    const clone = { ...row }
    delete clone.date
    delete clone.time
    return clone as T
  })

const tradovateRequest = async <T>(
  baseUrl: string,
  path: string,
  options: { accessToken?: string; method?: string; body?: unknown } = {}
) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message = data?.errorText || data?.message || `${response.status} ${response.statusText}`
    throw new Error(message)
  }

  if (data?.errorText) {
    throw new Error(data.errorText)
  }

  return data as T
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const authHeader = request.headers.get('Authorization')

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return jsonResponse(500, { error: 'Supabase function environment variables are missing.' })
    }

    if (!authHeader) {
      return jsonResponse(401, { error: 'Missing authorization header.' })
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    })

    const {
      data: { user },
      error: userError
    } = await userClient.auth.getUser()

    if (userError || !user) {
      return jsonResponse(401, { error: 'Unable to verify the current user.' })
    }

    const body = (await request.json()) as SyncRequest
    const environment = body.environment === 'demo' ? 'demo' : 'live'
    const baseUrl = tradovateBaseUrls[environment]

    if (!body.name || !body.password) {
      return jsonResponse(400, { error: 'Tradovate username and password are required.' })
    }

    let authResponse: { accessToken: string }
    try {
      authResponse = await tradovateRequest<{ accessToken: string }>(`${baseUrl}`, '/auth/accessTokenRequest', {
        method: 'POST',
        body: {
          name: body.name,
          password: body.password,
          appId: body.appId || 'TradeWise',
          appVersion: body.appVersion || '1.0',
          cid: body.cid || '0',
          ...(body.sec ? { sec: body.sec } : {})
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tradovate authentication failed.'
      return jsonResponse(401, { error: buildAuthErrorMessage(environment, message) })
    }

    const accessToken = authResponse.accessToken
    if (!accessToken) {
      return jsonResponse(502, { error: 'Tradovate did not return an access token.' })
    }

    const accounts = await tradovateRequest<AccountEntity[]>(baseUrl, '/account/list', { accessToken })
    const activeAccounts = accounts.filter((account) => account.active !== false)

    const accountFills = new Map<string, FillEntity[]>()
    const accountSummaries: Array<{ accountName: string; imported: number; skipped: number }> = []

    for (const account of activeAccounts) {
      const orders = await tradovateRequest<OrderEntity[]>(
        baseUrl,
        `/order/deps?masterid=${encodeURIComponent(String(account.id))}`,
        { accessToken }
      )
      const orderIds = orders
        .map((order) => order.id ?? order.orderId ?? null)
        .filter((value): value is number => typeof value === 'number')

      if (!orderIds.length) {
        accountFills.set(account.name, [])
        continue
      }

      const fills: FillEntity[] = []
      for (const orderChunk of chunk(orderIds, 200)) {
        const chunkFills = await tradovateRequest<FillEntity[]>(
          baseUrl,
          `/fill/ldeps?masterids=${encodeURIComponent(orderChunk.join(','))}`,
          { accessToken }
        )
        fills.push(...chunkFills)
      }

      accountFills.set(account.name, fills)
    }

    const contractIds = Array.from(
      new Set(Array.from(accountFills.values()).flat().map((fill) => fill.contractId).filter(Boolean))
    )

    const contractMap = new Map<number, string>()
    for (const contractChunk of chunk(contractIds, 200)) {
      const contracts = await tradovateRequest<ContractEntity[]>(
        baseUrl,
        `/contract/items?ids=${encodeURIComponent(contractChunk.join(','))}`,
        { accessToken }
      )
      for (const contract of contracts) {
        contractMap.set(contract.id, contract.name)
      }
    }

    const earliest = body.importStartDate ? new Date(`${body.importStartDate}T00:00:00.000Z`) : null
    const derivedTrades = Array.from(accountFills.entries()).flatMap(([accountName, fills]) => {
      const mapped = fills
        .filter((fill) => {
          if (!earliest) return true
          const timestamp = new Date(fill.timestamp)
          return !Number.isNaN(timestamp.getTime()) && timestamp >= earliest
        })
        .map((fill) => ({
          sourceAccount: accountName,
          entryTs: fill.timestamp,
          side: fill.action === 'Buy' ? 'Long' : 'Short',
          ticker: contractMap.get(fill.contractId) || String(fill.contractId),
          qty: Math.abs(fill.qty),
          pnl: 0,
          fillPrice: fill.price,
          rawPayload: {
            tradovateEnvironment: environment,
            fill
          }
        }))

      return derivePnls(mapped)
    })

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false }
    })

    const { data: existingTrades, error: existingError } = await adminClient
      .from('trades')
      .select('source_account, entry_ts, ticker, side, type, qty, pnl, change')
      .eq('user_id', user.id)
      .eq('source_broker', 'Tradovate')

    if (existingError) {
      return jsonResponse(500, { error: existingError.message })
    }

    const existingKeys = new Set(
      ((existingTrades ?? []) as ExistingTradeRow[]).map((trade) =>
        buildTradeKey({
          sourceAccount: trade.source_account ?? '',
          entryTs: trade.entry_ts,
          ticker: trade.ticker,
          side: trade.side,
          type: trade.type,
          qty: trade.qty,
          pnl: trade.pnl,
          change: trade.change
        })
      )
    )

    let skippedCount = 0
    const rows: InsertTradeRow[] = []
    const summaryMap = new Map<string, { imported: number; skipped: number }>()

    for (const trade of derivedTrades) {
      const key = buildTradeKey({
        sourceAccount: trade.sourceAccount,
        entryTs: trade.entryTs,
        ticker: trade.ticker,
        side: trade.side,
        type: 'Future',
        qty: trade.qty,
        pnl: trade.pnl,
        change: 'Filled'
      })

      const accountSummary = summaryMap.get(trade.sourceAccount) ?? { imported: 0, skipped: 0 }

      if (existingKeys.has(key)) {
        skippedCount += 1
        accountSummary.skipped += 1
        summaryMap.set(trade.sourceAccount, accountSummary)
        continue
      }

      existingKeys.add(key)
      const timestamp = new Date(trade.entryTs)
      rows.push({
        user_id: user.id,
        entry_ts: trade.entryTs,
        date: Number.isNaN(timestamp.getTime()) ? null : formatDatePart(timestamp),
        time: Number.isNaN(timestamp.getTime()) ? null : formatTimePart(timestamp),
        side: trade.side,
        type: 'Future',
        ticker: trade.ticker,
        qty: trade.qty,
        pnl: trade.pnl,
        change: 'Filled',
        source_account: trade.sourceAccount,
        source_broker: 'Tradovate',
        commission: null,
        fill_price: trade.fillPrice,
        raw_payload: trade.rawPayload
      })
      accountSummary.imported += 1
      summaryMap.set(trade.sourceAccount, accountSummary)
    }

    if (rows.length) {
      const { error: insertError } = await adminClient.from('trades').insert(rows)
      if (insertError) {
        const leanRows = stripOptionalColumns(rows)
        const { error: leanError } = await adminClient.from('trades').insert(leanRows)
        if (leanError) {
          const minimalRows = stripDateTimeColumns(leanRows)
          const { error: minimalError } = await adminClient.from('trades').insert(minimalRows)
          if (minimalError) {
            return jsonResponse(500, { error: minimalError.message })
          }
        }
      }
    }

    for (const account of activeAccounts) {
      const summary = summaryMap.get(account.name) ?? { imported: 0, skipped: 0 }
      accountSummaries.push({ accountName: account.name, imported: summary.imported, skipped: summary.skipped })
    }

    return jsonResponse(200, {
      insertedCount: rows.length,
      skippedCount,
      accountSummaries
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Tradovate sync error.'
    return jsonResponse(500, { error: message })
  }
})