// Papéis do household (compartilhado entre servidor e cliente do Better Auth).
// A autorização de DADOS é feita pela RLS no Postgres; isto controla só ações do plugin
// de organização (convidar, remover membros, apagar household).
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

export const ac = createAccessControl(defaultStatements);

export const owner = ac.newRole(ownerAc.statements);
export const adult = ac.newRole({ ac: ["read"] });
export const child = ac.newRole({ ac: ["read"] });
export const viewer = ac.newRole({ ac: ["read"] });

export const roles = { owner, adult, child, viewer };
