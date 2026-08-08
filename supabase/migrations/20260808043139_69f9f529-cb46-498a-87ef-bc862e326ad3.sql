-- 1. Restore Data API grants (lost during remix). RLS policies already exist.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', r.tablename);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', r.tablename);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

-- 2. Seed configuration/reference data (idempotent).
INSERT INTO public.pipeline_stages (name, position, color, sla_days, is_closed, is_won, default_probability)
SELECT * FROM (VALUES
  ('Qualification',       1, '#0057B8',  5, false, false, 10),
  ('Demo',                2, '#2563EB',  7, false, false, 30),
  ('Proposal Submitted',  3, '#7C3AED',  7, false, false, 55),
  ('Negotiation',         4, '#F59E0B',  5, false, false, 75),
  ('Closed-Won',          5, '#16A34A',  0, true,  true, 100),
  ('Closed-Lost',         6, '#DC2626',  0, true,  false,  0)
) AS v(name, position, color, sla_days, is_closed, is_won, default_probability)
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_stages);

INSERT INTO public.app_settings (id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.loss_reasons (label, position)
SELECT * FROM (VALUES
  ('Price too high', 1),
  ('Chose a competitor', 2),
  ('No budget', 3),
  ('No decision / timing', 4),
  ('Missing features', 5),
  ('Unresponsive', 6),
  ('Other', 7)
) AS v(label, position)
WHERE NOT EXISTS (SELECT 1 FROM public.loss_reasons);

INSERT INTO public.automation_rules (id, name, description, trigger_type, trigger_label, object, enabled, config)
VALUES
  ('lead_new_to_contacted','Lead contacted follow-up','Creates a BANT qualification call when a lead moves to Contacted.','status_change','Lead status changes to Contacted','lead',true,'{"due_in_days":2}'),
  ('lead_to_qualified','Lead qualified','Creates a demo-prep task when a lead is qualified.','status_change','Lead status changes to Qualified','lead',true,'{"due_in_days":1}'),
  ('lead_converted','Lead converted','Creates a demo scheduling task when a lead converts to a deal.','conversion','Lead converted to deal','lead',true,'{"due_in_days":2}'),
  ('deal_to_proposal','Proposal stage','Creates a send-proposal task with reminder.','stage_change','Deal moves to Proposal Submitted','deal',true,'{"due_in_days":1,"reminder_in_days":3}'),
  ('deal_to_negotiation','Negotiation follow-up','Creates a negotiation follow-up call.','stage_change','Deal moves to Negotiation','deal',true,'{"due_in_days":2}'),
  ('deal_won','Deal won','Creates welcome and renewal tasks and notifies managers.','stage_change','Deal moves to Closed-Won','deal',true,'{"welcome_due_in_days":1,"renewal_due_in_days":330}'),
  ('deal_lost','Deal lost','Requires a loss reason and schedules a re-engagement check.','stage_change','Deal moves to Closed-Lost','deal',true,'{"reengagement_due_in_days":90}'),
  ('sla_monitor','SLA monitor','Flags leads and deals past their stage SLA.','scheduled','Runs periodically','system',true,'{}'),
  ('reminder_dispatch','Task reminders','Sends reminders for tasks that reach their reminder time.','scheduled','Runs periodically','task',true,'{}'),
  ('daily_digest','Daily digest','Sends each user a daily summary of tasks and new leads.','scheduled','Runs daily','system',true,'{}'),
  ('reengagement_sweep','Re-engagement sweep','Surfaces disqualified leads past a 90-day cooldown.','scheduled','Runs daily','lead',true,'{}')
ON CONFLICT (id) DO NOTHING;

-- 3. First-run account bootstrap (replaces the auth trigger lost during remix).
CREATE OR REPLACE FUNCTION public.ensure_user_bootstrap(_full_name text DEFAULT NULL)
RETURNS app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _role app_role;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'ensure_user_bootstrap requires an authenticated session';
  END IF;

  INSERT INTO public.profiles (id, full_name)
  VALUES (_uid, COALESCE(NULLIF(TRIM(_full_name), ''), (SELECT email FROM auth.users WHERE id = _uid)))
  ON CONFLICT (id) DO NOTHING;

  SELECT role INTO _role FROM public.user_roles WHERE user_id = _uid
   ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END LIMIT 1;

  IF _role IS NULL THEN
    -- The very first account to sign in owns the workspace; everyone else is a rep.
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
      _role := 'admin';
    ELSE
      _role := 'rep';
    END IF;
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN _role;
END $$;

REVOKE ALL ON FUNCTION public.ensure_user_bootstrap(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_user_bootstrap(text) TO authenticated;