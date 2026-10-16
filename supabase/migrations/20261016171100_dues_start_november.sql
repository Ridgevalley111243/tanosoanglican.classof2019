-- Migration 12: dues are collected from November 2026 (due 5 December 2026).
--
-- The project owner removed the founding admins' unpaid October 2026 rows by
-- hand in the SQL editor (no payment referenced them):
--   delete from public.dues_months
--    where period < date '2026-11-01' and paid_at is null
--      and not exists (select 1 from public.payment_allocations a where a.dues_month_id = dues_months.id);
-- The applied migration below records the change and makes November the default.
alter table public.group_settings alter column dues_start set default date '2026-11-01';
update public.group_settings set dues_start = date '2026-11-01', updated_at = now() where id = 1;
insert into public.audit_logs (actor_id, action, target_table, target_id, details)
values (null, 'settings.updated', 'group_settings', '1',
        jsonb_build_object('dues_start', jsonb_build_array('2026-10-01', '2026-11-01'), 'note', 'Set by the project owner'));
