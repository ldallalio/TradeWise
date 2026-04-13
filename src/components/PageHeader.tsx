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
    </header>
  )
}
