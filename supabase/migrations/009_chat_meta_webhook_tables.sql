-- 009: ย้าย chat inbox meta + LINE webhook idempotency/audit จาก settings blob ไปตารางจริง
-- แก้ปัญหา read-modify-write race บน serverless (หลาย instance เขียนทับกัน) และลด latency ต่อข้อความ
-- DDL อย่างเดียว — การย้ายข้อมูลจาก blob เดิม (SITE_CHAT_INBOX_META) โค้ดเว็บทำให้อัตโนมัติตอน boot แรก

create table if not exists public.chat_session_meta (
  session_id text primary key,
  meta jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0
);
alter table public.chat_session_meta enable row level security;

create table if not exists public.line_webhook_events (
  event_key text primary key,
  at bigint not null default 0
);
alter table public.line_webhook_events enable row level security;

create table if not exists public.line_webhook_audits (
  id text primary key,
  at bigint not null default 0,
  event_key text not null default '',
  event_type text not null default '',
  source_key text not null default '',
  message_type text not null default '',
  text_preview text not null default '',
  result text not null default '',
  duration_ms bigint not null default 0,
  error text not null default '',
  note text not null default ''
);
create index if not exists idx_line_webhook_audits_at on public.line_webhook_audits (at desc);
alter table public.line_webhook_audits enable row level security;
