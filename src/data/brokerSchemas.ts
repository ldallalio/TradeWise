import type { Trade } from './mockData'

export type SchemaColumn = {
  label: string
  description: string
  required?: boolean
  sample?: string
  mapsTo?: keyof Trade
}

export type BrokerSchema = {
  broker: string
  filePattern?: string
  notes?: string
  columns: SchemaColumn[]
}

export const brokerSchemas: Record<string, BrokerSchema> = {
  TradingView: {
    broker: 'TradingView',
    filePattern: 'paper-trading-order-history-*.csv',
    notes:
      'TradingView exports include both placing and closing timestamps. We use the closing time when available to set the trade timestamp.',
    columns: [
      {
        label: 'Symbol',
        mapsTo: 'ticker',
        required: true,
        sample: 'CME_MINI:NQ1!',
        description: 'Instrument identifier including market prefix.'
      },
      {
        label: 'Side',
        mapsTo: 'side',
        required: true,
        sample: 'Buy / Sell',
        description: 'Direction of the order (Buy, Sell, Long, Short).'
      },
      {
        label: 'Type',
        mapsTo: 'type',
        required: true,
        sample: 'Market',
        description: 'Order type such as Market, Limit, Stop.'
      },
      {
        label: 'Qty',
        mapsTo: 'qty',
        required: true,
        sample: '1',
        description: 'Filled quantity for the order.'
      },
      {
        label: 'Limit Price',
        description: 'Limit price attached to conditional orders.',
        sample: '24576'
      },
      {
        label: 'Stop Price',
        description: 'Stop trigger price for stop or stop-limit orders.',
        sample: '24656'
      },
      {
        label: 'Fill Price',
        description: 'Actual fill price recorded by TradingView.',
        sample: '24576'
      },
      {
        label: 'Status',
        mapsTo: 'change',
        description: 'Filled, Cancelled, or other order status.',
        sample: 'Filled'
      },
      {
        label: 'Commission',
        description: 'Commission paid for the order in account currency.',
        sample: '0.85'
      },
      {
        label: 'Placing Time',
        mapsTo: 'entry_ts',
        description: 'ISO timestamp for when the order was submitted.',
        sample: '2025-11-18T18:02:12Z'
      },
      {
        label: 'Closing Time',
        mapsTo: 'entry_ts',
        description: 'ISO timestamp for when the order completed.',
        sample: '2025-11-18T18:02:12Z'
      },
      {
        label: 'Order ID',
        description: 'Numeric identifier for each order instance.',
        sample: '2479188880'
      },
      {
        label: 'Level ID',
        description: 'Internal TradingView level reference.',
        sample: '10:1'
      },
      {
        label: 'Leverage',
        description: 'Leverage applied to the order.',
        sample: '10:1'
      },
      {
        label: 'Margin',
        description: 'Margin requirement recorded in the export.',
        sample: '49,152.00 USD'
      }
    ]
  },
  Tradovate: {
    broker: 'Tradovate',
    filePattern: 'fills-*.csv',
    notes:
      'Tradovate exports typically include raw metadata columns (prefixed with an underscore) and the user-readable columns (e.g., “Contract”, “Timestamp”). We map the Timestamp (local) + Date columns to your trade time and use Contract/Product to populate tickers.',
    columns: [
      { label: 'orderId', description: 'Internal Tradovate order identifier.' },
      { label: 'Account', mapsTo: 'source_account', required: true, sample: 'APEX344...0010', description: 'Account receiving fills.' },
      { label: 'Order ID', description: 'User-facing order identifier; appears twice in Tradovate export.' },
      { label: 'B/S', mapsTo: 'side', required: true, sample: 'Buy / Sell', description: 'Fill direction.' },
      { label: 'Contract', mapsTo: 'ticker', required: true, sample: 'MNQZ5', description: 'Contract symbol (e.g., MNQZ5, NQZ5).' },
      { label: 'Product', description: 'Root symbol (MNQ, NQ).' },
      { label: 'Product Description', description: 'Friendly description (e.g., Micro E-mini NASDAQ-100).' },
      { label: 'avgPrice', description: 'Average price from the broker for the order.' },
      { label: 'filledQty', description: 'Number of contracts filled in this row.' },
      { label: 'Fill Time', description: 'Human-readable timestamp of the fill.' },
      { label: 'lastCommandId', description: 'Internal reference for the last command applied.' },
      { label: 'Status', mapsTo: 'change', description: 'Final status (Filled, Cancelled, etc.).' },
      { label: '_priceFormat', description: 'Internal price format indicator.' },
      { label: '_priceFormatType', description: 'Internal price format type.' },
      { label: '_tickSize', description: 'Tick size for the contract (e.g., 0.25).' },
      { label: 'spreadDefinitionId', description: 'Spread definition reference if applicable.' },
      { label: 'Version ID', description: 'Version identifier for the fill record.' },
      { label: 'Timestamp', description: 'Local timestamp (MM/DD/YYYY HH:MM:SS).' },
      { label: 'Date', mapsTo: 'date', required: true, description: 'Date portion (MM/DD/YY).' },
      { label: 'Quantity', mapsTo: 'qty', sample: '1', description: 'Quantity column provided in some exports.' },
      { label: 'Text', description: 'Free-form notes text attached to the order.' },
      { label: 'Type', mapsTo: 'type', description: 'Order type (Market, Limit, etc.).' },
      { label: 'Limit Price', description: 'Limit price, if provided.' },
      { label: 'Stop Price', description: 'Stop trigger price, if provided.' },
      { label: 'decimalLimit', description: 'Numeric limit price representation.' },
      { label: 'decimalStop', description: 'Numeric stop price representation.' },
      { label: 'Filled Qty', description: 'Additional filled quantity column.' },
      { label: 'Avg Fill Price', description: 'Average fill price across the order.' },
      { label: 'decimalFillAvg', description: 'Numeric average fill price.' },
      { label: 'commission', description: 'Commission or fee per fill.', sample: '1.04' }
    ]
  },
  'Generic CSV Format': {
    broker: 'Generic CSV Format',
    notes:
      'Use this structure when manually formatting a CSV. Only the highlighted “required” columns are necessary; the others are optional but recommended.',
    columns: [
      {
        label: 'Date',
        mapsTo: 'date',
        required: true,
        sample: '2025-11-18',
        description: 'ISO formatted date (YYYY-MM-DD).'
      },
      {
        label: 'Time',
        mapsTo: 'time',
        required: true,
        sample: '18:02',
        description: '24h time (HH:MM). Seconds optional.'
      },
      {
        label: 'Ticker / Symbol',
        mapsTo: 'ticker',
        required: true,
        sample: 'NQ',
        description: 'Ticker symbol of the traded instrument.'
      },
      {
        label: 'Side',
        mapsTo: 'side',
        required: true,
        sample: 'Long / Short',
        description: 'Long/Short, Buy/Sell, or similar notation.'
      },
      {
        label: 'Asset Type',
        mapsTo: 'type',
        sample: 'Future',
        description: 'Classification such as Option, Stock, Future.'
      },
      {
        label: 'Quantity',
        mapsTo: 'qty',
        sample: '1',
        description: 'Size of the trade.'
      },
      {
        label: 'P&L',
        mapsTo: 'pnl',
        sample: '150.25',
        description: 'Realized profit or loss for the record.'
      },
      {
        label: 'Status / Notes',
        mapsTo: 'change',
        sample: 'Closed',
        description: 'Any free-form column containing notes or order status.'
      }
    ]
  },
  Default: {
    broker: 'Default',
    notes: 'No dedicated schema yet. Follow the generic CSV format so we can map the data automatically.',
    columns: []
  }
}
