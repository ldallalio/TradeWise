type Props = {
  title: string
  subtitle?: string
}

export function PageHeader({ title, subtitle }: Props) {
  return (
    <header className="content-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="subtle">{subtitle}</p>}
      </div>
      <div className="header-actions">
        <button className="circle-btn" aria-label="View mode">
          👁️
        </button>
        <button className="circle-btn" aria-label="Theme">
          🌙
        </button>
        <button className="circle-btn" aria-label="Settings">
          ⚙️
        </button>
      </div>
    </header>
  )
}
