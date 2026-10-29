import { migrate, migrateOptionsFromEnv } from "../src/migrator";

await migrate(migrateOptionsFromEnv());
console.log("Migrações concluídas.");
