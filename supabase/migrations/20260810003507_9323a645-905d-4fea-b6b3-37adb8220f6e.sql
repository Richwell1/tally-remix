DO $migration$
DECLARE
  table_name text;
  protected_tables text[] := ARRAY[
    'activities', 'app_settings', 'audit_log', 'automation_rules', 'automation_runs',
    'companies', 'contacts', 'deal_stage_history', 'deals', 'email_queue',
    'invoices', 'invoice_items', 'leads', 'loss_reasons', 'notifications',
    'pipeline_stages', 'profiles', 'quotes', 'quote_items', 'quote_catalog_items',
    'tasks', 'user_roles'
  ];
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS require_verified_mfa ON public.%I', table_name);
      EXECUTE format(
        'CREATE POLICY require_verified_mfa ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((auth.jwt() ->> ''aal'') = ''aal2'') WITH CHECK ((auth.jwt() ->> ''aal'') = ''aal2'')',
        table_name
      );
    END IF;
  END LOOP;
END
$migration$;