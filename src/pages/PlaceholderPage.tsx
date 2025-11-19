import { PageHeader } from '../components/PageHeader'

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} subtitle="Coming soon" />
      <section className="panel">
        <p className="muted">This section is ready for your future content.</p>
      </section>
    </>
  )
}
