import "server-only";
import { adminHouseholdList, type AdminHouseholdRow } from "@organizeup/db";
import { ONBOARDING_VERSION } from "@/lib/onboarding";
import { formatDate, formatDateTime } from "../format";

const PAGE_SIZE = 25;

/** Já formatada no servidor: a lista é desenhada no cliente, onde a formatação poderia variar. */
export interface FamilyRow {
  id: string;
  name: string;
  createdAt: string;
  members: number;
  lastSession: string;
  onboardingDone: boolean;
}

export interface FamiliesState {
  rows: FamilyRow[];
  q: string;
  page: number;
  hasNext: boolean;
  message: string | null;
}

const toRow = (row: AdminHouseholdRow): FamilyRow => ({
  id: row.id,
  name: row.name,
  createdAt: formatDate(row.createdAt),
  members: row.members,
  lastSession: row.lastSessionAt ? formatDateTime(row.lastSessionAt) : "Nunca",
  onboardingDone: row.onboardingVersion >= ONBOARDING_VERSION,
});

export async function loadFamilies(q: string, page: number): Promise<FamiliesState> {
  // Uma linha a mais só para saber se existe a próxima página.
  const found = await adminHouseholdList({
    limit: PAGE_SIZE + 1,
    offset: page * PAGE_SIZE,
    q,
  });
  return {
    rows: found.slice(0, PAGE_SIZE).map(toRow),
    q,
    page,
    hasNext: found.length > PAGE_SIZE,
    message: null,
  };
}
