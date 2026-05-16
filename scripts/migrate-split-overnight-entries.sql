-- Split legacy OT entries that cross midnight into two rows inside entries JSONB.
--
-- Example:
--   2026-05-11 21:00 -> 01:30
-- becomes:
--   2026-05-11 21:00 -> 24:00
--   2026-05-12 00:00 -> 01:30
--
-- Run this in Supabase SQL Editor or any Postgres client connected to the same DB.
-- The script is idempotent for already-migrated data because it only touches rows
-- where endTime is strictly smaller than startTime.
--
-- Optional preview before running:
-- select
--   p.id,
--   p.username,
--   entry->>'id' as entry_id,
--   entry->>'date' as entry_date,
--   entry->>'startTime' as start_time,
--   entry->>'endTime' as end_time
-- from public.otworker_profiles as p
-- cross join lateral jsonb_array_elements(coalesce(p.entries, '[]'::jsonb)) as entry
-- where
--   (entry->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
--   and (
--     ((entry->>'startTime') ~ '^(?:[01]\d|2[0-3]):[0-5]\d$') or entry->>'startTime' = '24:00'
--   )
--   and (
--     ((entry->>'endTime') ~ '^(?:[01]\d|2[0-3]):[0-5]\d$') or entry->>'endTime' = '24:00'
--   )
--   and (
--     case
--       when entry->>'endTime' = '24:00' then 1440
--       else split_part(entry->>'endTime', ':', 1)::int * 60 + split_part(entry->>'endTime', ':', 2)::int
--     end
--   ) < (
--     case
--       when entry->>'startTime' = '24:00' then 1440
--       else split_part(entry->>'startTime', ':', 1)::int * 60 + split_part(entry->>'startTime', ':', 2)::int
--     end
--   )
-- order by p.username, entry->>'date', entry->>'startTime';

begin;

do $$
declare
  profile_row record;
  entry jsonb;
  migrated_entries jsonb;
  start_time text;
  end_time text;
  start_minutes integer;
  end_minutes integer;
  next_date text;
  base_id text;
  changed_profiles integer := 0;
  changed_entries integer := 0;
  created_entries integer := 0;
  has_changes boolean;
begin
  for profile_row in
    select id, username, entries
    from public.otworker_profiles
    where jsonb_typeof(coalesce(entries, '[]'::jsonb)) = 'array'
  loop
    migrated_entries := '[]'::jsonb;
    has_changes := false;

    for entry in
      select value
      from jsonb_array_elements(coalesce(profile_row.entries, '[]'::jsonb))
    loop
      start_time := nullif(btrim(entry->>'startTime'), '');
      end_time := nullif(btrim(entry->>'endTime'), '');

      if
        (entry->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
        and (
          (start_time ~ '^(?:[01]\d|2[0-3]):[0-5]\d$') or start_time = '24:00'
        )
        and (
          (end_time ~ '^(?:[01]\d|2[0-3]):[0-5]\d$') or end_time = '24:00'
        )
      then
        start_minutes := case
          when start_time = '24:00' then 1440
          else split_part(start_time, ':', 1)::int * 60 + split_part(start_time, ':', 2)::int
        end;

        end_minutes := case
          when end_time = '24:00' then 1440
          else split_part(end_time, ':', 1)::int * 60 + split_part(end_time, ':', 2)::int
        end;

        if end_minutes < start_minutes then
          base_id := coalesce(
            nullif(entry->>'id', ''),
            'ot-migrated-' || substr(md5(profile_row.id::text || ':' || entry::text), 1, 12)
          );
          next_date := to_char(((entry->>'date')::date + 1), 'YYYY-MM-DD');

          migrated_entries := migrated_entries || jsonb_build_array(
            entry || jsonb_build_object(
              'id', base_id,
              'date', entry->>'date',
              'startTime', start_time,
              'endTime', '24:00'
            )
          );

          if end_minutes > 0 then
            migrated_entries := migrated_entries || jsonb_build_array(
              entry || jsonb_build_object(
                'id', base_id || '-next-day',
                'date', next_date,
                'startTime', '00:00',
                'endTime', end_time
              )
            );
            created_entries := created_entries + 1;
          end if;

          changed_entries := changed_entries + 1;
          has_changes := true;
          continue;
        end if;
      end if;

      migrated_entries := migrated_entries || jsonb_build_array(entry);
    end loop;

    if has_changes then
      update public.otworker_profiles
      set entries = migrated_entries
      where id = profile_row.id;

      changed_profiles := changed_profiles + 1;
    end if;
  end loop;

  raise notice
    'Split overnight OT complete. Profiles updated: %, overnight entries split: %, new entries created: %',
    changed_profiles,
    changed_entries,
    created_entries;
end
$$;

commit;
