-- Complete PostgreSQL setup for local development (psycopg2 direct connection).
-- Vector search is handled by ChromaDB — pgvector is NOT required.
-- This is a standalone file — run ONLY this, not supabase-setup.sql.
--
-- Usage:
--   psql -U postgres -c "CREATE DATABASE projectdb;"
--   psql -U postgres -d projectdb -f postgres-local-setup.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extensions
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;  -- gen_random_uuid() for PostgreSQL < 13

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists files (
  id             uuid primary key default gen_random_uuid(),
  filename       text not null,
  filetype       text not null,
  file_url       text,
  uploaded_by    text not null,
  accessible_to  text[] not null default '{}',
  uploaded_at    timestamptz default now(),
  locked_by_id   text,
  locked_by_name text,
  locked_at      timestamptz,
  version        integer not null default 1,
  updated_by     text,
  updated_at     timestamptz
);

-- Embeddings stored in ChromaDB — no vector column needed here.
create table if not exists chunks (
  id                     uuid primary key default gen_random_uuid(),
  file_id                uuid references files(id) on delete cascade,
  chunk_text             text not null,
  chunk_summary          text,
  keywords               text[] default '{}',
  hypothetical_questions text[] default '{}',
  chunk_index            integer,
  created_at             timestamptz default now()
);

create table if not exists feed_cache (
  id           text primary key default 'latest',
  data         jsonb not null,
  generated_at timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists action_items (
  id            uuid primary key default gen_random_uuid(),
  file_id       uuid references files(id) on delete cascade,
  filename      text not null,
  accessible_to text[] not null default '{}',
  items         jsonb not null default '[]',
  assigned_by   text,
  source_type   text default 'file',
  source_id     uuid,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists action_items_file_id_idx on action_items(file_id);

create table if not exists minutes (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  summary       text default '',
  attendees     jsonb default '[]',
  decisions     jsonb default '[]',
  action_items  jsonb default '[]',
  transcript    text default '',
  created_by    text,
  accessible_to text[] not null default '{}',
  created_at    timestamptz default now()
);

create index if not exists minutes_accessible_idx on minutes using gin(accessible_to);

create table if not exists quiz_scores (
  user_id      text primary key,
  user_name    text not null,
  quiz_id      text not null default 'rag-basics',
  score        integer not null,
  total        integer not null default 5,
  attempted_at timestamptz default now()
);

create table if not exists report_templates (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null,
  filetype      text not null,
  file_url      text,
  template_text text not null,
  uploaded_by   text not null,
  uploaded_at   timestamptz default now()
);

create table if not exists users (
  id         text primary key,
  name       text not null,
  role       text not null,
  part       text,
  team       text,
  created_at timestamptz default now()
);

create table if not exists task_forces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  status     text not null default 'Active',
  parts      text[] not null default '{}',
  teams      text[] not null default '{}',
  owners     text[] not null default '{}',
  members    text[] not null default '{}',
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists tf_updates (
  id         uuid primary key default gen_random_uuid(),
  tf_id      uuid references task_forces(id) on delete cascade,
  type       text not null,
  author     text not null,
  content    text not null,
  created_at timestamptz default now()
);

create index if not exists tf_updates_tf_id_idx on tf_updates(tf_id);

create table if not exists tf_action_items (
  id         uuid primary key default gen_random_uuid(),
  tf_id      uuid references task_forces(id) on delete cascade,
  text       text not null,
  assignee   text,
  due        date,
  done       boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists tf_action_items_tf_id_idx on tf_action_items(tf_id);

create table if not exists email_tokens (
  key        text primary key,
  tokens     jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists chatroom_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text not null default '',
  sender_id       text not null,
  sender_name     text not null,
  content         text not null,
  created_at      timestamptz default now()
);

create index if not exists chatroom_messages_conv_idx on chatroom_messages(conversation_id, created_at);

-- Embeddings stored in ChromaDB — no vector column needed here.
create table if not exists chatroom_chunks (
  id             uuid primary key default gen_random_uuid(),
  chunk_text     text not null,
  topic_summary  text,
  processed_date date not null,
  created_at     timestamptz default now()
);

create index if not exists chatroom_chunks_date_idx on chatroom_chunks(processed_date);

create table if not exists rag_evaluations (
  id                 uuid primary key default gen_random_uuid(),
  query              text not null,
  answer             text,
  context_precision  float,
  faithfulness       float,
  response_relevance float,
  created_at         timestamptz default now()
);

create table if not exists rag_eval_summary (
  id                     integer primary key default 1,
  avg_context_precision  float not null default 0,
  avg_faithfulness       float not null default 0,
  avg_response_relevance float not null default 0,
  total_count            integer not null default 0,
  updated_at             timestamptz default now()
);

insert into rag_eval_summary (id) values (1) on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Functions
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function update_rag_eval_summary(
  context_precision  float default null,
  faithfulness       float default null,
  response_relevance float default null
)
returns void
language plpgsql
as $$
declare
  current_count integer;
begin
  select total_count into current_count from rag_eval_summary where id = 1;
  if not found then
    insert into rag_eval_summary (id, avg_context_precision, avg_faithfulness, avg_response_relevance, total_count)
    values (1,
      coalesce(context_precision, 0),
      coalesce(faithfulness, 0),
      coalesce(response_relevance, 0),
      1);
  else
    update rag_eval_summary set
      avg_context_precision  = (avg_context_precision  * current_count + coalesce(context_precision,  avg_context_precision))  / (current_count + 1),
      avg_faithfulness       = (avg_faithfulness       * current_count + coalesce(faithfulness,       avg_faithfulness))       / (current_count + 1),
      avg_response_relevance = (avg_response_relevance * current_count + coalesce(response_relevance, avg_response_relevance)) / (current_count + 1),
      total_count = current_count + 1,
      updated_at  = now()
    where id = 1;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed users
-- ─────────────────────────────────────────────────────────────────────────────

insert into users (id, name, role, part, team) values
  ('u_md',        'Aryan Sharma',  'MD',       null,               null),
  ('u_ph_tm',     'Arjun Mehta',   'PartHead', 'Tech Management',  null),
  ('u_ph_prism',  'John Iyer',     'PartHead', 'PRISM',            null),
  ('u_ph_dm',     'Karan Shah',    'PartHead', 'Data Management',  null),
  ('u_ph_pmo',    'Ranjit Bose',   'PartHead', 'PMO',              null),
  ('u_mem_tm',    'Sam Patel',     'Member',   'Tech Management',  null),
  ('u_mem_prism', 'Nadia Verma',   'Member',   'PRISM',            null),
  ('u_mem_dm',    'Diego Alvarez', 'Member',   'Data Management',  null),
  ('u_mem_dm2',   'Ravi Kumar',    'Member',   'Data Management',  null),
  ('u_mem_pmo',   'Lina Joshi',    'Member',   'PMO',              null),
  ('u_th_t1',     'Asha Rao',      'TeamHead', null,               'Team 1'),
  ('u_mem_t1',    'Vikram Singh',  'Member',   null,               'Team 1'),
  ('u_th_t2',     'Marco Bianchi', 'TeamHead', null,               'Team 2'),
  ('u_mem_t2',    'Lea Fischer',   'Member',   null,               'Team 2'),
  ('u_th_t3',     'Hiro Tanaka',   'TeamHead', null,               'Team 3'),
  ('u_mem_t3',    'Elena Costa',   'Member',   null,               'Team 3')
on conflict (id) do nothing;
