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
  uploaded_at  timestamptz default now()
);

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
  part_filter     text,
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
  where f.accessible_to @> array[part_filter]
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

