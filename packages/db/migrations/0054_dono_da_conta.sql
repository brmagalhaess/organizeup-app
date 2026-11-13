-- 0054: de quem é cada conta e cada cartão. Só operações aditivas.
--
-- Pedido do fundador em 2026-11-13: com duas pessoas trazendo lançamentos pelo banco, a tela precisa dizer de
-- quem é cada um e comparar quanto cada pessoa gastou. O lançamento herda a pessoa da conta em que caiu, e a
-- fatura herda a do cartão: não há coluna nova em `transactions`. Sem dono, a conta é de uso comum.

ALTER TABLE accounts
  ADD COLUMN person_id text,
  ADD CONSTRAINT accounts_person_fk FOREIGN KEY (household_id, person_id)
    REFERENCES people(household_id, id) ON DELETE SET NULL (person_id);

ALTER TABLE credit_cards
  ADD COLUMN person_id text,
  ADD CONSTRAINT credit_cards_person_fk FOREIGN KEY (household_id, person_id)
    REFERENCES people(household_id, id) ON DELETE SET NULL (person_id);

-- Sem preenchimento aqui: a conta e o cartão ligados a um banco já são, na leitura, da pessoa da chave
-- (`bank_connections.person_id`). A coluna guarda só a escolha feita na tela, que vale mais que a do banco.
