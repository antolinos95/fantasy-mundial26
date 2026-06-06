-- schema_v10: Web Push subscriptions

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table push_subscriptions enable row level security;

-- Users can only manage their own subscriptions
create policy "own subs" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Service role can read all (for sending notifications)
create policy "service read" on push_subscriptions
  for select using (auth.role() = 'service_role');
