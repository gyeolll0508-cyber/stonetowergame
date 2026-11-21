-- =========================================================
-- campus_layout.sql — 관리자 모드(index3d.html?admin)에서 바꾼 걸 모두에게 적용하기
--  Supabase 대시보드 → SQL Editor 에 전부 붙여 넣고 Run 하세요. (여러 번 실행해도 괜찮아요)
--
--  - campus_layout: 건물 배치(JSON) 1줄. 누구나 읽을 수 있어요.
--  - save_campus_layout(배치): 건물 배치 저장
--  - admin_delete_tower(돌탑 id): 돌탑 지우기
--  ※ 비밀번호가 없어서 ?admin 주소를 아는 사람은 누구나 배치를 바꾸고 돌탑을 지울 수 있어요.
-- =========================================================

create table if not exists public.campus_layout (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.campus_layout enable row level security;
drop policy if exists "campus_layout read" on public.campus_layout;
create policy "campus_layout read" on public.campus_layout for select using (true);

-- 예전(비밀번호 있던) 버전을 실행했었다면 정리
drop function if exists public.check_admin_pin(text);
drop function if exists public.save_campus_layout(text, jsonb);
drop function if exists public.admin_delete_tower(text, text);
drop table if exists public.admin_secret;

create or replace function public.save_campus_layout(p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare t timestamptz;
begin
  if jsonb_typeof(p_data -> 'places') <> 'array' or length(p_data::text) > 200000 then
    raise exception 'bad layout';
  end if;
  insert into campus_layout (id, data, updated_at) values (1, p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now()
  returning updated_at into t;
  return t;
end;
$$;

-- 돌탑 지우기 (stone_towers의 id 종류와 상관없이 글자로 비교해요)
create or replace function public.admin_delete_tower(p_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from stone_towers where id::text = p_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.save_campus_layout(jsonb) from public;
revoke all on function public.admin_delete_tower(text) from public;
grant execute on function public.save_campus_layout(jsonb) to anon, authenticated;
grant execute on function public.admin_delete_tower(text) to anon, authenticated;
