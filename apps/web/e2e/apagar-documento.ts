// Só para o e2e: deixa uma conta como as de antes do pedido de documento. Precisa de ADMIN_DATABASE_URL.
import { closeAllPools, eq, user, userIdentity, withAdmin } from "@organizeup/db";

const [email] = process.argv.slice(2);
if (!email) throw new Error("Informe o e-mail.");

await withAdmin("e2e: conta sem documento", async (admin) => {
  const [row] = await admin.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!row) throw new Error("Conta não encontrada.");
  await admin.delete(userIdentity).where(eq(userIdentity.userId, row.id));
});
await closeAllPools();
