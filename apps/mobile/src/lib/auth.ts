// Sessão do app: o mesmo Better Auth do site. O plugin do Expo guarda o cookie da sessão no cofre do
// aparelho (Keychain no iPhone, Keystore no Android) e o manda em cada pedido.
import { expoClient } from "@better-auth/expo/client";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { API_URL, APP_SCHEME } from "./config";

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({ scheme: APP_SCHEME, storagePrefix: APP_SCHEME, storage: SecureStore }),
    organizationClient(),
    twoFactorClient(),
  ],
});
