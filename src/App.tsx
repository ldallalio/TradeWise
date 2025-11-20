import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import './App.css'
import { trades } from './data/mockData'
import { DashboardPage } from './pages/DashboardPage'
import { CalendarPage } from './pages/CalendarPage'
import { TradesPage } from './pages/TradesPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { LockedPage } from './pages/LockedPage'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'
import { ImportPage } from './pages/ImportPage'

type NavItem = {
  label: string
  to: string
  icon: string
  locked?: boolean
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: 'icon-dashboard' },
  { label: 'Calendar', to: '/calendar', icon: 'icon-calendar' },
  { label: 'Trades', to: '/trades', icon: 'icon-bar' },
  { label: 'Analysis', to: '/analysis', icon: 'icon-chart' },
  { label: 'Import', to: '/import', icon: 'icon-chart' },
  { label: 'Insights', to: '/insights', icon: 'icon-spark', locked: true },
  { label: 'Journal', to: '/journal', icon: 'icon-note', locked: true }
]

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false)
  const [accountOptions, setAccountOptions] = useState<{ id: string; broker: string }[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[] | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const accountDropdownRef = useRef<HTMLDivElement | null>(null)

  const loadAccountOptions = useCallback(
    async (uid?: string) => {
      if (!uid) {
        setAccountOptions([])
        setSelectedAccounts(null)
        return
      }
      const { data, error } = await supabase
        .from('trades')
        .select('source_account, source_broker')
        .eq('user_id', uid)
        .not('source_account', 'is', null)
      if (error) {
        console.error('Unable to load accounts', error)
        return
      }
      const unique = new Map<string, { id: string; broker: string }>()
      data?.forEach((row: any) => {
        const id = row.source_account
        if (!id) return
        if (!unique.has(id)) {
          unique.set(id, { id, broker: row.source_broker || 'Unknown' })
        }
      })
      const options = Array.from(unique.values()).sort((a, b) => a.id.localeCompare(b.id))
      setAccountOptions(options)
      setSelectedAccounts((prev) => {
        if (prev === null) return null
        const filtered = prev.filter((id) => options.some((opt) => opt.id === id))
        if (!filtered.length) {
          return options.length ? null : []
        }
        return filtered
      })
    },
    []
  )

  const accountIds = useMemo(() => accountOptions.map((opt) => opt.id), [accountOptions])

  useEffect(() => {
    const initAuth = async () => {
      const { data } = await supabase.auth.getSession()
      setSession(data.session ?? null)
      setAuthLoading(false)
      loadAccountOptions(data.session?.user?.id)
    }
    initAuth()
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      loadAccountOptions(newSession?.user?.id)
    })
    return () => {
      listener?.subscription.unsubscribe()
    }
  }, [loadAccountOptions])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    setAuthLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setAuthError(error.message)
    }
    setAuthLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setSelectedAccounts(null)
  }

  useEffect(() => {
    if (!accountDropdownOpen) return
    const handleClick = (event: MouseEvent) => {
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
        setAccountDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('mousedown', handleClick)
    }
  }, [accountDropdownOpen])

  const toggleAccountSelection = (accountId: string) => {
    setSelectedAccounts((prev) => {
      if (prev === null) {
        const current = accountIds
        const next = current.filter((id) => id !== accountId)
        return next.length === current.length ? null : next
      }
      const exists = prev.includes(accountId)
      const next = exists ? prev.filter((id) => id !== accountId) : [...prev, accountId]
      if (next.length === accountIds.length) return null
      return next
    })
  }

  const selectAllAccounts = () => setSelectedAccounts(null)
  const clearAccounts = () => setSelectedAccounts([])

  const accountSummary = useMemo(() => {
    if (selectedAccounts === null || selectedAccounts.length === accountIds.length) {
      return 'All accounts'
    }
    if (!selectedAccounts.length) return 'No accounts selected'
    if (selectedAccounts.length === 1) return selectedAccounts[0]
    return `${selectedAccounts.length} accounts`
  }, [selectedAccounts, accountIds.length])

  useEffect(() => {
    if (!mobileSidebarOpen) {
      setAccountDropdownOpen(false)
    }
  }, [mobileSidebarOpen])

  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [location.pathname])

  if (!session && !authLoading) {
    return (
      <div className="login-screen">
        <div className="login-card panel">
          <h1>TraderWise</h1>
          <p className="subtle">Sign in to access your journal</p>
          <form className="login-form" onSubmit={handleLogin}>
            <label className="label">
              Email
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="label">
              Password
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {authError && <div className="error-text">Error: {authError}</div>}
            <button className="pill-button gradient" type="submit" disabled={authLoading}>
              {authLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileSidebarOpen ? 'mobile-open' : ''}`}>
        <button
          className="mobile-sidebar-toggle"
          type="button"
          onClick={() => setMobileSidebarOpen((open) => !open)}
        >
          <div>
            <span className="mobile-brand">TraderWise</span>
            <span className="mobile-summary">{accountSummary}</span>
          </div>
          <span className={`chevron ${mobileSidebarOpen ? 'open' : ''}`}>▾</span>
        </button>

        <div className="sidebar-inner">
          <NavLink
            to="/"
            className="brand"
            onClick={() => {
              if (mobileSidebarOpen) setMobileSidebarOpen(false)
            }}
          >
            <div className="brand-icon" />
            <div className="brand-text">
              <span>TraderWise</span>
            </div>
          </NavLink>

          <div className="profile">
            <div className="avatar">L</div>
            <div className="profile-meta">
              <div className="name">{session?.user?.email ?? 'Logged in'}</div>
              <button className="link subtle button-link" type="button" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          </div>

          <div className="sidebar-card account-filter" ref={accountDropdownRef}>
            <span className="label">Accounts</span>
            <button className="selector" type="button" onClick={() => setAccountDropdownOpen((open) => !open)}>
              <span>{accountSummary}</span>
              <span className={`chevron ${accountDropdownOpen ? 'open' : ''}`}>▾</span>
            </button>
            {accountDropdownOpen && (
              <div className="account-dropdown">
                <div className="account-actions">
                  <button className="small-btn" type="button" onClick={selectAllAccounts}>
                    Select all
                  </button>
                  <button className="small-btn" type="button" onClick={clearAccounts}>
                    Clear
                  </button>
                </div>
                <div className="account-options">
                  {accountOptions.length ? (
                    accountOptions.map((option) => {
                      const checked =
                        selectedAccounts === null || selectedAccounts.includes(option.id) || accountIds.length === 0
                      return (
                        <label key={option.id} className="account-option">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAccountSelection(option.id)}
                          />
                          <span>
                            <strong>{option.id}</strong>
                            <span className="muted tiny block">{option.broker}</span>
                          </span>
                        </label>
                      )
                    })
                  ) : (
                    <div className="muted tiny">No accounts detected yet.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <nav className="nav">
            {navItems.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                className={({ isActive }) =>
                  `nav-item ${isActive ? 'active' : ''} ${item.locked ? 'locked' : ''}`
                }
                onClick={(e) => {
                  if (item.locked) {
                    e.preventDefault()
                    return
                  }
                  if (mobileSidebarOpen) setMobileSidebarOpen(false)
                }}
              >
                <span className={`icon ${item.icon} ${item.locked ? 'muted' : ''}`} />
                <span className="nav-label">{item.label}</span>
                {item.locked && <span className="lock">🔒</span>}
              </NavLink>
            ))}
          </nav>

          <div className="sidebar-actions">
            <button
              className="pill-button gradient soft"
              type="button"
              onClick={() => {
                navigate('/import')
                if (mobileSidebarOpen) setMobileSidebarOpen(false)
              }}
            >
              ⬇ Import
            </button>
          </div>
        </div>
      </aside>

      <main className="content">
        <div className="page-wrap">
          <Routes>
            <Route
              path="/"
              element={
                <DashboardPage trades={trades} userId={session?.user?.id} selectedAccounts={selectedAccounts} />
              }
            />
            <Route
              path="/calendar"
              element={<CalendarPage userId={session?.user?.id} selectedAccounts={selectedAccounts} />}
            />
            <Route
              path="/trades"
              element={<TradesPage trades={trades} userId={session?.user?.id} selectedAccounts={selectedAccounts} />}
            />
            <Route path="/import" element={<ImportPage userId={session?.user?.id} />} />
            <Route path="/analysis" element={<PlaceholderPage title="Analysis" />} />
            <Route path="/insights" element={<LockedPage title="Insights" />} />
            <Route path="/journal" element={<LockedPage title="Journal" />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
