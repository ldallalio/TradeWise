import { PageHeader } from '../components/PageHeader'

export function LockedPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} subtitle="Locked" />
      <section className="panel locked-panel">
        <p className="muted">This area is locked in the mock. Navigation is disabled.</p>
      </section>
    </>
  )
}
