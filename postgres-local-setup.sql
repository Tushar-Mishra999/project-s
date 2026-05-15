-- Local PostgreSQL setup — run this AFTER supabase-setup.sql
-- Only needed when using native PostgreSQL + PostgREST (no Docker, no Supabase cloud).
-- Cloud Supabase handles all of this automatically — do NOT run this there.
--
-- Run order:
--   1. psql -U postgres -d projectdb -f supabase-setup.sql
--   2. psql -U postgres -d projectdb -f postgres-local-setup.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extensions
-- ─────────────────────────────────────────────────────────────────────────────

-- pgcrypto provides gen_random_uuid() on PostgreSQL < 13.
-- On PostgreSQL 13+ it is built-in, but this is a safe no-op.
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PostgREST role
-- ─────────────────────────────────────────────────────────────────────────────
-- PostgREST uses a dedicated role (web_anon) to execute all queries.
-- This role must have explicit permissions on every table and function.
-- If you used db-anon-role = "postgres" in postgrest.conf (superuser),
-- this section is not strictly required but is recommended for security.

do $$ begin
  if not exists (select from pg_roles where rolname = 'web_anon') then
    create role web_anon nologin;
  end if;
end $$;

grant usage on schema public to web_anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Table permissions
-- ─────────────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on
  files,
  chunks,
  feed_cache,
  action_items,
  minutes,
  quiz_scores,
  report_templates,
  users,
  task_forces,
  tf_updates,
  tf_action_items,
  email_tokens,
  chatroom_messages,
  chatroom_chunks,
  rag_evaluations,
  rag_eval_summary
to web_anon;

-- Sequences (used internally by PostgreSQL even though we use UUID primary keys)
grant usage, select on all sequences in schema public to web_anon;

-- Future tables created after this script will also be accessible
alter default privileges in schema public
  grant select, insert, update, delete on tables to web_anon;

alter default privileges in schema public
  grant usage, select on sequences to web_anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Function permissions
-- ─────────────────────────────────────────────────────────────────────────────

grant execute on function match_chunks(vector, text, int) to web_anon;
grant execute on function match_chatroom_chunks(vector, int) to web_anon;

alter default privileges in schema public
  grant execute on functions to web_anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Missing RPC — update_rag_eval_summary
-- ─────────────────────────────────────────────────────────────────────────────
-- This function is called by the FastAPI backend after each RAG evaluation
-- but is absent from supabase-setup.sql. Supabase cloud silently ignores
-- unknown RPCs; PostgREST returns a 404 without this.

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
      avg_context_precision  = (avg_context_precision  * current_count + coalesce(context_precision, avg_context_precision))  / (current_count + 1),
      avg_faithfulness       = (avg_faithfulness       * current_count + coalesce(faithfulness, avg_faithfulness))             / (current_count + 1),
      avg_response_relevance = (avg_response_relevance * current_count + coalesce(response_relevance, avg_response_relevance)) / (current_count + 1),
      total_count = current_count + 1,
      updated_at  = now()
    where id = 1;
  end if;
end;
$$;

grant execute on function update_rag_eval_summary(float, float, float) to web_anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Update postgrest.conf to use web_anon
-- ─────────────────────────────────────────────────────────────────────────────
-- After running this script, update your postgrest.conf:
--
--   db-anon-role = "web_anon"          ← change from "postgres"
--   jwt-secret   = "your-32-char-key"  ← keep as-is
--
-- And restart PostgREST:
--   C:\postgrest\postgrest.exe C:\postgrest\postgrest.conf
