-- O responsável liga ou desliga os avisos por e-mail de cada pessoa que acessa a família (ADR-0046). Só
-- políticas novas, sem mudar dado: cada login continua vendo e mudando a própria linha, e o responsável passa
-- a ver e gravar as linhas de quem é membro da mesma família.
CREATE POLICY email_reminders_owner_select ON email_reminders FOR SELECT
  USING (household_id = app_household_id() AND app_role() = 'owner');
CREATE POLICY email_reminders_owner_insert ON email_reminders FOR INSERT
  WITH CHECK (
    household_id = app_household_id()
    AND app_role() = 'owner'
    AND EXISTS (
      SELECT 1 FROM household_member m
      WHERE m.household_id = app_household_id() AND m.user_id = email_reminders.user_id
    )
  );
CREATE POLICY email_reminders_owner_update ON email_reminders FOR UPDATE
  USING (household_id = app_household_id() AND app_role() = 'owner')
  WITH CHECK (
    household_id = app_household_id()
    AND app_role() = 'owner'
    AND EXISTS (
      SELECT 1 FROM household_member m
      WHERE m.household_id = app_household_id() AND m.user_id = email_reminders.user_id
    )
  );
