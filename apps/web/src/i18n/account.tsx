"use client";
// Tipo da conta no navegador (ADR-0022). Vem do layout raiz. No servidor, `account-server.ts`.
import { accountFeatures, type AccountType } from "@organizeup/domain";
import { createContext, useContext, type ReactNode } from "react";

const Account = createContext<AccountType>("pf");

export function AccountTypeProvider({
  type,
  children,
}: {
  type: AccountType;
  children: ReactNode;
}) {
  return <Account.Provider value={type}>{children}</Account.Provider>;
}

/** O que existe nesta conta: parentesco, casamento, dependentes, participação. */
export const useAccountFeatures = () => accountFeatures(useContext(Account));
