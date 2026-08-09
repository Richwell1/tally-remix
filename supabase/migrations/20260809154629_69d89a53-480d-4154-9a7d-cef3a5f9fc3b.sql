DROP POLICY IF EXISTS co_select_all_auth ON public.companies;

CREATE POLICY co_select_scoped ON public.companies
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR account_manager_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.contacts c WHERE c.company_id = companies.id AND c.assigned_to = auth.uid())
  OR EXISTS (SELECT 1 FROM public.deals d WHERE d.company_id = companies.id AND d.assigned_to = auth.uid())
);