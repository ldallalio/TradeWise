create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_date date not null,
  title text not null,
  symbol text,
  mood text not null check (mood in ('confident', 'neutral', 'frustrated', 'focused')),
  tags text[] not null default '{}',
  notes text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists journal_entries_user_created_idx
  on public.journal_entries(user_id, created_at desc);

alter table public.journal_entries enable row level security;

-- Drop and recreate policies (idempotent, compatible with PostgreSQL 15)
drop policy if exists "journal entries select own" on public.journal_entries;
create policy "journal entries select own"
  on public.journal_entries
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "journal entries insert own" on public.journal_entries;
create policy "journal entries insert own"
  on public.journal_entries
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "journal entries update own" on public.journal_entries;
create policy "journal entries update own"
  on public.journal_entries
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "journal entries delete own" on public.journal_entries;
create policy "journal entries delete own"
  on public.journal_entries
  for delete
  to authenticated
  using (auth.uid() = user_id);
