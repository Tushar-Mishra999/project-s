-- Run this once in the Supabase SQL Editor to set up the RAG schema.
-- Embedding dimension = 1024 (Voyage AI voyage-3).
-- If you previously ran an older 1536-dim version of this script, run:
--   drop function if exists match_chunks(vector,text,int);
--   drop table if exists chunks;
-- before re-running this file.

-- 1. Enable pgvector
create extension if not exists vector;

-- 2. files table
create table if not exists files (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null,
  filetype     text not null,
  file_url     text,
  uploaded_by  text not null,
  accessible_to text[] not null default '{}',
  uploaded_at  timestamptz default now(),
  locked_by_id text,
  locked_by_name text,
  locked_at    timestamptz
);

-- Add lock columns to existing databases (no-ops if already present).
alter table files add column if not exists locked_by_id text;
alter table files add column if not exists locked_by_name text;
alter table files add column if not exists locked_at timestamptz;

-- Versioning: track in-place replacements done via "Upload new version".
alter table files add column if not exists version integer not null default 1;
alter table files add column if not exists updated_by text;
alter table files add column if not exists updated_at timestamptz;

-- 3. chunks table
create table if not exists chunks (
  id                     uuid primary key default gen_random_uuid(),
  file_id                uuid references files(id) on delete cascade,
  chunk_text             text not null,
  chunk_summary          text,
  keywords               text[] default '{}',
  hypothetical_questions text[] default '{}',
  embedding              vector(1024),
  chunk_index            integer,
  created_at             timestamptz default now()
);

-- 4. HNSW index for fast cosine-similarity search
create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);

-- 5. RPC for filtered vector search.
-- Filters by Part-level access *before* similarity, then returns top-k.
create or replace function match_chunks(
  query_embedding vector(1024),
  part_filter     text default null,
  match_count     int default 20
)
returns table (
  id                     uuid,
  file_id                uuid,
  chunk_text             text,
  chunk_summary          text,
  keywords               text[],
  hypothetical_questions text[],
  chunk_index            integer,
  similarity             float,
  filename               text,
  filetype               text,
  file_url               text,
  uploaded_by            text
)
language sql stable
as $$
  select
    c.id,
    c.file_id,
    c.chunk_text,
    c.chunk_summary,
    c.keywords,
    c.hypothetical_questions,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding) as similarity,
    f.filename,
    f.filetype,
    f.file_url,
    f.uploaded_by
  from chunks c
  join files f on f.id = c.file_id
  where part_filter is null or f.accessible_to @> array[part_filter]
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- 6. Storage bucket. Run in the Supabase Storage UI:
--    Create a PUBLIC bucket named "documents".

-- 7. Feed cache (single-row table holding the most recent Tech Sensing Feed run).
create table if not exists feed_cache (
  id           text primary key default 'latest',
  data         jsonb not null,
  generated_at timestamptz default now(),
  updated_at   timestamptz default now()
);

-- 8. Action items — one row per document, items stored as a JSONB array.
--    Each item: { "id": "uuid", "text": "...", "completed": false }
create table if not exists action_items (
  id            uuid primary key default gen_random_uuid(),
  file_id       uuid references files(id) on delete cascade,
  filename      text not null,
  accessible_to text[] not null default '{}',
  items         jsonb not null default '[]',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists action_items_file_id_idx on action_items(file_id);

-- Assigner of an action-items card (the user who reviewed and saved the items).
-- Items inside `items` have the shape:
--   { id, text, completed, assignees: [user_id, ...] }
alter table action_items add column if not exists assigned_by text;

-- Action items can come from a file (default) or from a saved MoM.
-- For MoM-sourced cards, file_id stays NULL and source_type/source_id are set.
alter table action_items add column if not exists source_type text default 'file';
alter table action_items add column if not exists source_id   uuid;

-- Minutes of Meeting — persisted with access control.
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

-- AI Quiz scores — one row per user (latest attempt overrides earlier).
create table if not exists quiz_scores (
  user_id      text primary key,
  user_name    text not null,
  quiz_id      text not null default 'rag-basics',
  score        integer not null,
  total        integer not null default 5,
  attempted_at timestamptz default now()
);

-- 9. Report templates — uploaded once, reused to generate filled reports.
create table if not exists report_templates (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null,
  filetype      text not null,
  file_url      text,
  template_text text not null,
  uploaded_by   text not null,
  uploaded_at   timestamptz default now()
);

-- 10. Users (organisation members + external team members).
-- role values: 'MD' | 'PartHead' | 'TeamHead' | 'Member'
-- Internal users (MD, PartHead, internal Member) have `part` set
-- ('Tech Management', 'PRISM', 'Data Management', 'PMO').
-- External users (TeamHead, external Member) have `team` set
-- ('Team 1', 'Team 2', 'Team 3').
create table if not exists users (
  id          text primary key,
  name        text not null,
  role        text not null,
  part        text,
  team        text,
  created_at  timestamptz default now()
);

-- 11. Task forces. Owners/members are user-id arrays; parts/teams are labels.
create table if not exists task_forces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  status      text not null default 'Active',
  parts       text[] not null default '{}',
  teams       text[] not null default '{}',
  owners      text[] not null default '{}',
  members     text[] not null default '{}',
  created_by  text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 12. Task-force updates feed.
-- type values: 'Status' | 'Milestone' | 'Risk' | 'Decision' | 'ACTION_ITEM'
create table if not exists tf_updates (
  id         uuid primary key default gen_random_uuid(),
  tf_id      uuid references task_forces(id) on delete cascade,
  type       text not null,
  author     text not null,
  content    text not null,
  created_at timestamptz default now()
);

create index if not exists tf_updates_tf_id_idx on tf_updates(tf_id);

-- 13. Task-force action items.
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

-- 14. Gmail OAuth tokens — one row per key (currently just 'gmail').
create table if not exists email_tokens (
  key        text primary key,
  tokens     jsonb not null,
  updated_at timestamptz default now()
);

-- 15. Executive Chatroom — private channel for MD and Part Heads.
create table if not exists chatroom_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  sender_id       text not null,
  sender_name     text not null,
  content         text not null,
  created_at      timestamptz default now()
);

-- For existing tables without conversation_id:
alter table chatroom_messages add column if not exists conversation_id text not null default '';

create index if not exists chatroom_messages_conv_idx on chatroom_messages(conversation_id, created_at);

-- 17. Chatroom chunks — AI-partitioned topical segments produced by the nightly 7am job.
--     Each row represents a group of messages from a single day that discuss the same topic.
create table if not exists chatroom_chunks (
  id             uuid primary key default gen_random_uuid(),
  chunk_text     text not null,
  topic_summary  text,
  embedding      vector(1024),
  processed_date date not null,
  created_at     timestamptz default now()
);

create index if not exists chatroom_chunks_embedding_idx
  on chatroom_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists chatroom_chunks_date_idx
  on chatroom_chunks(processed_date);

create or replace function match_chatroom_chunks(
  query_embedding vector(1024),
  match_count     int default 5
)
returns table (
  id             uuid,
  chunk_text     text,
  topic_summary  text,
  processed_date date,
  similarity     float
)
language sql stable
as $$
  select
    id,
    chunk_text,
    topic_summary,
    processed_date,
    1 - (embedding <=> query_embedding) as similarity
  from chatroom_chunks
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- 18. Seed users (idempotent — re-running this file leaves existing rows untouched).
insert into users (id, name, role, part, team) values
  ('u_md',        'Aryan Sharma',  'MD',       null,                 null),
  ('u_ph_tm',     'Arjun Mehta',   'PartHead', 'Tech Management',    null),
  ('u_ph_prism',  'John Iyer',     'PartHead', 'PRISM',              null),
  ('u_ph_dm',     'Karan Shah',    'PartHead', 'Data Management',    null),
  ('u_ph_pmo',    'Ranjit Bose',   'PartHead', 'PMO',                null),
  ('u_mem_tm',    'Sam Patel',     'Member',   'Tech Management',    null),
  ('u_mem_prism', 'Nadia Verma',   'Member',   'PRISM',              null),
  ('u_mem_dm',    'Diego Alvarez', 'Member',   'Data Management',    null),
  ('u_mem_dm2',   'Ravi Kumar',   'Member',   'Data Management',    null),
  ('u_mem_pmo',   'Lina Joshi',    'Member',   'PMO',                null),
  ('u_th_t1',     'Asha Rao',      'TeamHead', null,                 'Team 1'),
  ('u_mem_t1',    'Vikram Singh',  'Member',   null,                 'Team 1'),
  ('u_th_t2',     'Marco Bianchi', 'TeamHead', null,                 'Team 2'),
  ('u_mem_t2',    'Lea Fischer',   'Member',   null,                 'Team 2'),
  ('u_th_t3',     'Hiro Tanaka',   'TeamHead', null,                 'Team 3'),
  ('u_mem_t3',    'Elena Costa',   'Member',   null,                 'Team 3')
on conflict (id) do nothing;

