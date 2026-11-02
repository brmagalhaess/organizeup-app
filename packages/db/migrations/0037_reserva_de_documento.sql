-- 0037: reserva o documento antes de criar a conta, e confere se a chave do cofre é a mesma (ADR-0022). Só
-- aditiva. Publicada antes do código: enquanto ninguém chama estas funções, nada muda.
--
-- A RLS de `user_identity` deixa cada conta ver só a sua linha, e a FK não deixa gravar antes de a conta existir.
-- Por isso a duplicidade só aparecia depois de criar a conta, de abrir sessão e de mandar o e-mail de confirmação.
-- Estas funções respondem antes, sem abrir nenhuma linha: recebem um hash, que só a web sabe calcular, e devolvem
-- sim ou não. SECURITY DEFINER com o dono, que é superusuário: é o que passa pela RLS de `user_identity`.
--
-- A reserva guarda só o hash, por 2 minutos. Ela cobre o intervalo entre conferir e gravar: dois cadastros ao
-- mesmo tempo com o mesmo documento não passam os dois. Cadastro que morre no meio libera sozinho.
CREATE TABLE identity_reservations (
  hash        text PRIMARY KEY,
  expires_at  timestamptz NOT NULL
);

-- Ninguém lê nem grava direto: sem política, a conexão da web e a do worker não veem nada.
ALTER TABLE identity_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_reservations FORCE ROW LEVEL SECURITY;

-- Mesma regra dos índices da 0035: CPF só compete com pessoa física; CNPJ, sempre.
CREATE FUNCTION reserve_identity_document(p_kind text, p_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  reserved integer;
BEGIN
  DELETE FROM identity_reservations WHERE expires_at < now();
  IF (p_kind = 'cpf' AND EXISTS (
        SELECT 1 FROM user_identity WHERE cpf_hash = p_hash AND person_type = 'pf'))
     OR (p_kind = 'cnpj' AND EXISTS (
        SELECT 1 FROM user_identity WHERE cnpj_hash = p_hash)) THEN
    RETURN false;
  END IF;
  INSERT INTO identity_reservations (hash, expires_at)
    VALUES (p_hash, now() + interval '2 minutes')
    ON CONFLICT (hash) DO NOTHING;
  GET DIAGNOSTICS reserved = ROW_COUNT;
  RETURN reserved = 1;
END $$;

CREATE FUNCTION release_identity_document(p_hash text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM identity_reservations WHERE hash = p_hash;
$$;

-- O valor cifrado leva a impressão digital da chave: `v1.<kid>.<iv>.<tag>.<dado>`. Linha com outra impressão
-- digital quer dizer chave trocada: os hashes antigos não casam mais, e a duplicidade pararia de funcionar calada.
CREATE FUNCTION identity_key_mismatch(p_kid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_identity
    WHERE cpf_encrypted IS NOT NULL AND split_part(cpf_encrypted, '.', 2) <> p_kid);
$$;

REVOKE ALL ON FUNCTION reserve_identity_document(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_identity_document(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity_key_mismatch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_identity_document(text, text) TO ou_app;
GRANT EXECUTE ON FUNCTION release_identity_document(text) TO ou_app;
GRANT EXECUTE ON FUNCTION identity_key_mismatch(text) TO ou_app, ou_admin;
