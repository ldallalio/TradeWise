export type StatCard = { title: string; value: string; subtle?: string; type?: 'chart' | 'donut' }
export type Badge = { title: string; color: 'blue' | 'pink' | 'teal' }
export type Trade = {
  date: string
  time: string
  side: string
  type: string
  ticker: string
  qty: number
  pnl: number
  change: string
  entry_ts?: string | null
  source_account?: string | null
  source_broker?: string | null
}
export type MonthReturn = { label: string; value: number }
export type CalendarCell = { day: string; value?: number; wins?: number; losses?: number }

export const statsByRange: Record<string, StatCard[]> = {
  'All Time': [
    { title: 'Cumulative Return', value: '$1,741', subtle: 'All Time', type: 'chart' },
    { title: 'Profit Factor', value: '1.21', subtle: 'All Time' },
    { title: 'Average Return', value: '$12.9', subtle: 'All Time' },
    { title: 'Win Rate', value: '69.6%', subtle: 'All Time', type: 'donut' }
  ],
  'Last 30D': [
    { title: 'Cumulative Return', value: '$422', subtle: 'Last 30D', type: 'chart' },
    { title: 'Profit Factor', value: '1.34', subtle: 'Last 30D' },
    { title: 'Average Return', value: '$18.4', subtle: 'Last 30D' },
    { title: 'Win Rate', value: '71.2%', subtle: 'Last 30D', type: 'donut' }
  ],
  'Last 7D': [
    { title: 'Cumulative Return', value: '$188', subtle: 'Last 7D', type: 'chart' },
    { title: 'Profit Factor', value: '1.48', subtle: 'Last 7D' },
    { title: 'Average Return', value: '$22.1', subtle: 'Last 7D' },
    { title: 'Win Rate', value: '75.0%', subtle: 'Last 7D', type: 'donut' }
  ]
}

export const badges: Badge[] = [
  { title: '$1k+ Win', color: 'blue' },
  { title: 'Scalper', color: 'pink' },
  { title: '10+ Winning Streak', color: 'teal' },
  { title: '50%+ Winrate', color: 'blue' },
  { title: '100+ Trades', color: 'teal' }
]

export const trades: Trade[] = [
  { date: '2025-11-16', time: '19:26', side: 'Short', type: 'Future', ticker: 'NQ', qty: 3, pnl: -825, change: '-0.05%' },
  { date: '2025-11-16', time: '19:06', side: 'Long', type: 'Future', ticker: 'NQ', qty: 4, pnl: -845, change: '-0.04%' },
  { date: '2025-11-16', time: '19:05', side: 'Short', type: 'Future', ticker: 'NQ', qty: 1, pnl: 55, change: '+0.01%' },
  { date: '2025-11-16', time: '19:02', side: 'Short', type: 'Future', ticker: 'NQ', qty: 2, pnl: 155, change: '+0.02%' },
  { date: '2025-11-16', time: '18:54', side: 'Short', type: 'Future', ticker: 'NQ', qty: 4, pnl: 200, change: '+0.01%' }
]

export const monthReturnsByMonth: Record<string, MonthReturn[]> = {
  'November 2025': [
    { label: '03', value: -200 },
    { label: '04', value: 0 },
    { label: '05', value: 80 },
    { label: '06', value: 120 },
    { label: '07', value: 180 },
    { label: '08', value: 120 },
    { label: '09', value: -60 },
    { label: '10', value: 320 },
    { label: '11', value: 280 },
    { label: '12', value: 140 },
    { label: '13', value: 100 },
    { label: '14', value: -180 }
  ],
  'October 2025': [
    { label: '03', value: 220 },
    { label: '04', value: 90 },
    { label: '05', value: -60 },
    { label: '06', value: 140 },
    { label: '07', value: 180 },
    { label: '08', value: 210 },
    { label: '09', value: 80 },
    { label: '10', value: 60 },
    { label: '11', value: -50 },
    { label: '12', value: 120 },
    { label: '13', value: 140 },
    { label: '14', value: 260 }
  ]
}

export const calendarRows: CalendarCell[][] = [
  [
    { day: '03' },
    { day: '04' },
    { day: '05' },
    { day: '06', value: -706, wins: 5, losses: 3 },
    { day: '07', value: 308, wins: 5, losses: 2 },
    { day: '08' },
    { day: '09', value: 194, wins: 6, losses: 1 }
  ],
  [
    { day: '10', value: 877.5, wins: 12 },
    { day: '11', value: 1066, wins: 11, losses: 6 },
    { day: '12', value: 1747, wins: 14, losses: 1 },
    { day: '13', value: 340, wins: 8, losses: 1 },
    { day: '14', value: -10 },
    { day: '15' },
    { day: '16', value: -2075, wins: 6, losses: 8 }
  ],
  [
    { day: '17' },
    { day: '18' },
    { day: '19' },
    { day: '20' },
    { day: '21' },
    { day: '22' },
    { day: '23' }
  ],
  [
    { day: '24' },
    { day: '25' },
    { day: '26' },
    { day: '27' },
    { day: '28' },
    { day: '29' },
    { day: '30' }
  ]
]
