-- =====================================================================
--  Tutoring Center — database setup
--  Paste this WHOLE file into Supabase → SQL Editor → New query → Run.
--  Run it once on a fresh project.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------

-- Everyone who has a login: admin, teachers, students.
-- Levels: 1..12 = school grades, 13 = college (1st year), 14 = graduated.
-- The CURRENT grade is never stored: it is calculated from
-- level_base (grade when registered/edited) + how many Sept 1sts passed since.
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  username         text unique not null,
  role             text not null default 'student'
                   check (role in ('admin','teacher','pending_teacher','student','disabled')),
  first_name       text not null default '',
  last_name        text not null default '',
  phone            text not null default '',
  level_base       int check (level_base between 1 and 14),
  level_base_year  int,
  math_units       int check (math_units in (3,4,5)),
  pay_rate         numeric(10,2) not null default 0,   -- teacher pay per hour
  notes            text not null default '',
  created_at       timestamptz not null default now()
);

-- Price per hour, by student level.
create table public.price_groups (
  key           text primary key,
  label         text not null,
  min_level     int not null,
  max_level     int not null,
  hourly_price  numeric(10,2) not null default 0,
  sort          int not null default 0
);

insert into public.price_groups (key, label, min_level, max_level, hourly_price, sort) values
  ('elementary', 'Grades 1–6',        1,  6, 0, 1),
  ('middle',     'Grades 7–9',        7,  9, 0, 2),
  ('high',       'Grades 10–12',     10, 12, 0, 3),
  ('college',    'College 1st year', 13, 13, 0, 4),
  ('graduated',  'Graduated',        14, 14, 0, 5);

-- Lessons. Status flow:
--   scheduled  → planned by the admin, shows in the teacher's daily planner
--   pending    → teacher says "done" (or added a lesson) → waits for approval
--   approved   → confirmed by the admin, counts in the monthly report
--   rejected   → sent back to the teacher (can fix and resubmit)
--   cancelled  → did not happen
create table public.lessons (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid not null references public.profiles(id) on delete restrict,
  student_id      uuid not null references public.profiles(id) on delete restrict,
  subject         text not null,
  starts_at       timestamptz not null,
  duration_min    int not null check (duration_min between 10 and 480),
  status          text not null default 'scheduled'
                  check (status in ('scheduled','pending','approved','rejected','cancelled')),
  topic           text not null default '',   -- what the lesson is about / what to prepare
  teacher_note    text not null default '',
  admin_note      text not null default '',
  level_snapshot  int,                         -- student's grade on the lesson date
  created_by      uuid,
  created_at      timestamptz not null default now(),
  approved_at     timestamptz,
  approved_by     uuid
);
create index lessons_starts_idx  on public.lessons (starts_at);
create index lessons_teacher_idx on public.lessons (teacher_id, starts_at);
create index lessons_student_idx on public.lessons (student_id, starts_at);
create index lessons_status_idx  on public.lessons (status);

-- Money for each lesson. Only the admin can read this table.
create table public.lesson_money (
  lesson_id      uuid primary key references public.lessons(id) on delete cascade,
  student_price  numeric(10,2) not null default 0,  -- what the student pays
  teacher_pay    numeric(10,2) not null default 0   -- what you pay the teacher
);

-- ---------------------------------------------------------------------
--  Helper functions
-- ---------------------------------------------------------------------

create or replace function public.il_date(ts timestamptz)
returns date language sql stable as $$
  select (ts at time zone 'Asia/Jerusalem')::date
$$;

-- School year that contains date d (starts on September 1st).
create or replace function public.school_year(d date)
returns int language sql immutable as $$
  select case when extract(month from d) >= 9
              then extract(year from d)::int
              else extract(year from d)::int - 1 end
$$;

-- The student's level on date d. Goes up by 1 every September 1st.
-- After grade 12 (or after college 1st year) → 14 = graduated.
create or replace function public.level_at(base int, base_year int, d date)
returns int language sql immutable as $$
  select case
    when base is null or base_year is null then base
    when base >= 14 then 14
    when public.school_year(d) <= base_year then base
    when base = 13 then 14
    when base + (public.school_year(d) - base_year) > 12 then 14
    else base + (public.school_year(d) - base_year)
  end
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------------
--  New sign-ups → create their profile
--  (students become 'student'; teachers wait as 'pending_teacher'
--   until the admin approves them; nobody can sign up as admin)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wants text  := coalesce(m->>'account_type', 'student');
  lvl   int;
begin
  begin
    lvl := nullif(m->>'level', '')::int;
  exception when others then
    lvl := null;
  end;
  if lvl is not null and (lvl < 1 or lvl > 13) then lvl := null; end if;
  if wants = 'teacher' then lvl := null; end if;

  insert into public.profiles
    (id, username, role, first_name, last_name, phone, level_base, level_base_year, math_units)
  values (
    new.id,
    lower(coalesce(nullif(m->>'username', ''), split_part(new.email, '@', 1))),
    case when wants = 'teacher' then 'pending_teacher' else 'student' end,
    left(coalesce(m->>'first_name', ''), 60),
    left(coalesce(m->>'last_name', ''), 60),
    left(coalesce(m->>'phone', ''), 30),
    lvl,
    case when lvl is null then null else public.school_year(public.il_date(now())) end,
    case when wants <> 'teacher' and m->>'math_units' in ('3','4','5')
         then (m->>'math_units')::int else null end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only the admin may change role, grade, pay rate, username and notes.
-- (When run from the Supabase SQL editor there is no logged-in user,
--  so you can always fix things there.)
create or replace function public.guard_profile()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and public.my_role() is distinct from 'admin' then
    new.role            := old.role;
    new.username        := old.username;
    new.level_base      := old.level_base;
    new.level_base_year := old.level_base_year;
    new.math_units      := old.math_units;
    new.pay_rate        := old.pay_rate;
    new.notes           := old.notes;
  end if;
  new.id := old.id;
  return new;
end $$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile();

-- ---------------------------------------------------------------------
--  Lesson rules
-- ---------------------------------------------------------------------
create or replace function public.lessons_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r  text := public.my_role();
  st record;
begin
  if auth.uid() is not null and r is distinct from 'admin' then
    -- Teachers
    if r is distinct from 'teacher' then
      raise exception 'Only teachers and the admin can change lessons';
    end if;
    if tg_op = 'INSERT' then
      new.teacher_id := auth.uid();
      new.status     := 'pending';
      new.admin_note := '';
    else
      if old.status in ('approved', 'cancelled') then
        raise exception 'This lesson is already % and can''t be changed. Ask the admin.', old.status;
      end if;
      new.teacher_id := old.teacher_id;
      new.admin_note := old.admin_note;
      new.created_by := old.created_by;
      if new.status not in ('scheduled', 'pending') then
        raise exception 'Teachers can only mark lessons as done. The admin approves them.';
      end if;
    end if;
    new.approved_at := null;
    new.approved_by := null;
  else
    -- Admin
    if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
      new.approved_at := now();
      new.approved_by := auth.uid();
    elsif new.status <> 'approved' then
      new.approved_at := null;
      new.approved_by := null;
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;

  if not exists (select 1 from public.profiles where id = new.student_id and role = 'student') then
    raise exception 'Please choose a student';
  end if;
  if not exists (select 1 from public.profiles where id = new.teacher_id and role in ('teacher', 'admin')) then
    raise exception 'Please choose a teacher';
  end if;

  if tg_op = 'INSERT' or new.student_id <> old.student_id or new.starts_at <> old.starts_at then
    select level_base, level_base_year into st from public.profiles where id = new.student_id;
    new.level_snapshot := public.level_at(st.level_base, st.level_base_year, public.il_date(new.starts_at));
  end if;
  return new;
end $$;

create trigger lessons_before_write
  before insert or update on public.lessons
  for each row execute function public.lessons_before();

-- Calculate the price and the teacher's pay for one lesson.
create or replace function public.compute_money(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l    public.lessons;
  hp   numeric;
  rate numeric;
begin
  select * into l from public.lessons where id = p_id;
  if not found then return; end if;
  select hourly_price into hp from public.price_groups
    where l.level_snapshot between min_level and max_level order by sort limit 1;
  select pay_rate into rate from public.profiles where id = l.teacher_id;
  insert into public.lesson_money (lesson_id, student_price, teacher_pay)
  values (l.id,
          round(coalesce(hp, 0)   * l.duration_min / 60.0, 2),
          round(coalesce(rate, 0) * l.duration_min / 60.0, 2))
  on conflict (lesson_id) do update
    set student_price = excluded.student_price,
        teacher_pay   = excluded.teacher_pay;
end $$;

create or replace function public.lessons_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.student_id   = old.student_id
     and new.teacher_id   = old.teacher_id
     and new.starts_at    = old.starts_at
     and new.duration_min = old.duration_min
     and exists (select 1 from public.lesson_money where lesson_id = new.id) then
    return null;
  end if;
  perform public.compute_money(new.id);
  return null;
end $$;

create trigger lessons_after_write
  after insert or update on public.lessons
  for each row execute function public.lessons_after();

-- Admin: recalculate grades + prices for all lessons in a date range
-- (use it after changing prices or a teacher's pay rate).
create or replace function public.recalc_money(p_from timestamptz, p_to timestamptz)
returns int language plpgsql security definer set search_path = public as $$
declare
  rec record;
  n   int := 0;
begin
  if auth.uid() is not null and public.my_role() is distinct from 'admin' then
    raise exception 'Only the admin can do this';
  end if;
  for rec in select id, student_id, starts_at from public.lessons
             where starts_at >= p_from and starts_at < p_to loop
    update public.lessons l
       set level_snapshot = public.level_at(p.level_base, p.level_base_year, public.il_date(rec.starts_at))
      from public.profiles p
     where l.id = rec.id and p.id = rec.student_id;
    perform public.compute_money(rec.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Teacher: my totals for a month (only approved lessons count).
create or replace function public.my_month_summary(p_year int, p_month int)
returns table (lessons int, minutes int, pay numeric)
language sql stable security definer set search_path = public as $$
  select count(*)::int,
         coalesce(sum(l.duration_min), 0)::int,
         coalesce(sum(m.teacher_pay), 0)
    from public.lessons l
    join public.lesson_money m on m.lesson_id = l.id
   where l.teacher_id = auth.uid()
     and l.status = 'approved'
     and public.il_date(l.starts_at) >= make_date(p_year, p_month, 1)
     and public.il_date(l.starts_at) <  (make_date(p_year, p_month, 1) + interval '1 month')::date
$$;

revoke execute on function public.compute_money(uuid) from public, anon, authenticated;
revoke execute on function public.recalc_money(timestamptz, timestamptz) from public, anon;
grant  execute on function public.recalc_money(timestamptz, timestamptz) to authenticated;
revoke execute on function public.my_month_summary(int, int) from public, anon;
grant  execute on function public.my_month_summary(int, int) to authenticated;

-- Teacher names, so students can see who teaches them (no phone numbers).
create view public.people as
  select id, first_name, last_name, role
    from public.profiles
   where role in ('admin', 'teacher');
revoke all on public.people from anon;
grant select on public.people to authenticated;

-- ---------------------------------------------------------------------
--  Security (Row Level Security): who can see and change what
-- ---------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.price_groups enable row level security;
alter table public.lessons      enable row level security;
alter table public.lesson_money enable row level security;

-- profiles
create policy "profiles: read" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.my_role() = 'admin'
    or (public.my_role() = 'teacher' and role = 'student')
  );
create policy "profiles: update own or admin" on public.profiles for update to authenticated
  using (id = auth.uid() or public.my_role() = 'admin')
  with check (id = auth.uid() or public.my_role() = 'admin');

-- prices
create policy "prices: read" on public.price_groups for select to authenticated
  using (true);
create policy "prices: admin update" on public.price_groups for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- lessons
create policy "lessons: read" on public.lessons for select to authenticated
  using (
    public.my_role() = 'admin'
    or teacher_id = auth.uid()
    or student_id = auth.uid()
  );
create policy "lessons: add" on public.lessons for insert to authenticated
  with check (public.my_role() in ('admin', 'teacher'));
create policy "lessons: change" on public.lessons for update to authenticated
  using (public.my_role() = 'admin' or (public.my_role() = 'teacher' and teacher_id = auth.uid()))
  with check (public.my_role() = 'admin' or (public.my_role() = 'teacher' and teacher_id = auth.uid()));
create policy "lessons: delete" on public.lessons for delete to authenticated
  using (
    public.my_role() = 'admin'
    or (public.my_role() = 'teacher' and teacher_id = auth.uid()
        and created_by = auth.uid() and status in ('pending', 'rejected'))
  );

-- money: admin only
create policy "money: admin read" on public.lesson_money for select to authenticated
  using (public.my_role() = 'admin');

-- =====================================================================
--  LAST STEP (after you sign up on your website with your username):
--  make yourself the admin by running this line, with YOUR username:
--
--    update public.profiles set role = 'admin' where username = 'your-username';
-- =====================================================================
