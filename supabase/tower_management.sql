-- =========================================================
-- tower_management.sql — 내 돌탑 지우기(DELETE RLS 정책)
--  Supabase 대시보드 → SQL Editor 에서 실행하세요.
--
--  이 파일이 바꾸는 것: stone_towers에 "본인 돌탑만 삭제" 정책 1개 추가 (+ 삭제 권한 부여)
--  바꾸지 않는 것: 기존 데이터, 기존 SELECT/INSERT/UPDATE 정책, UNIQUE(owner_id), 다른 표
--  여러 번 실행해도 괜찮아요(같은 이름의 정책만 다시 만들어요).
--
--  ※ 1인 1탑 제한은 기존 UNIQUE(owner_id)가 서버에서 그대로 막아요(변경 없음).
-- =========================================================


-- ---------------------------------------------------------
-- [1단계] 확인만 (읽기 전용 — 아무것도 바꾸지 않아요)
--  아래 4개를 먼저 실행해서 결과를 확인하세요.
-- ---------------------------------------------------------

-- 1-a) owner_id 칸 종류 → data_type 이 uuid 여야 [2단계]를 그대로 쓸 수 있어요
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'stone_towers' and column_name = 'owner_id';

-- 1-b) 지금 있는 정책 → cmd = DELETE 인 행이 없어야 정상(지금 상태)
select policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'stone_towers'
order by cmd, policyname;

-- 1-c) 제약조건 → UNIQUE (owner_id) 가 보여야 해요 (그대로 둬요)
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.stone_towers'::regclass;

-- 1-d) stone_towers를 참조하는 다른 표(외래키) → 결과가 없으면 지워도 다른 표에 영향 없음
select conrelid::regclass as referencing_table, conname, pg_get_constraintdef(oid) as def
from pg_constraint
where confrelid = 'public.stone_towers'::regclass;


-- ---------------------------------------------------------
-- [2단계] 적용 — 본인 돌탑만 지울 수 있게 (1단계 결과가 정상일 때만)
--  1-a가 uuid가 아니면(text 등) 실행하지 말고 알려 주세요.
--  1-d에 결과가 있으면(ON DELETE 동작 확인 필요) 실행하지 말고 알려 주세요.
-- ---------------------------------------------------------
drop policy if exists "stone_towers delete own" on public.stone_towers;
create policy "stone_towers delete own"
  on public.stone_towers
  for delete
  to authenticated                       -- 익명 로그인 사용자도 authenticated 역할이에요
  using (owner_id = (select auth.uid())); -- 내 돌탑(owner_id = 내 user.id)만

grant delete on table public.stone_towers to authenticated;


-- ---------------------------------------------------------
-- [3단계] 확인 — DELETE 정책 1개가 보이면 완료
-- ---------------------------------------------------------
select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public' and tablename = 'stone_towers' and cmd = 'DELETE';


-- ---------------------------------------------------------
-- [되돌리기] 필요할 때만: 위 정책을 없애요 (데이터는 그대로)
-- ---------------------------------------------------------
-- drop policy if exists "stone_towers delete own" on public.stone_towers;
