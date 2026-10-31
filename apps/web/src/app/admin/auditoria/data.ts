import "server-only";
import { adminAccessList } from "@organizeup/db";
import { formatDateTime, shortId } from "../format";
import { actionLabel, AUDIT_REVEALS, AUDIT_VISITS } from "./labels";

const PAGE_SIZE = 30;

export type AuditGroup = "acoes" | "dados" | "visitas" | "tudo";

export interface AuditFilters {
  group: AuditGroup;
  days: number;
  target: string;
}

export const DEFAULT_AUDIT: AuditFilters = { group: "acoes", days: 30, target: "" };

export interface AuditRow {
  id: number;
  at: string;
  label: string;
  admin: string;
  familyId: string | null;
  userId: string | null;
  targetShort: string | null;
}

export interface AuditState {
  rows: AuditRow[];
  page: number;
  filters: AuditFilters;
  hasNext: boolean;
  message: string | null;
}

const byGroup = (group: AuditGroup) => {
  if (group === "acoes") return { excludeActions: [...AUDIT_VISITS, ...AUDIT_REVEALS] };
  if (group === "dados") return { actions: AUDIT_REVEALS };
  if (group === "visitas") return { actions: AUDIT_VISITS };
  return {};
};

export async function loadAudit(
  filters: AuditFilters,
  page: number,
  viewerId: string,
): Promise<AuditState> {
  const found = await adminAccessList({
    limit: PAGE_SIZE + 1,
    offset: page * PAGE_SIZE,
    sinceDays: filters.days || undefined,
    target: filters.target || undefined,
    ...byGroup(filters.group),
  });
  return {
    rows: found.slice(0, PAGE_SIZE).map((entry) => {
      const target = entry.targetHouseholdId ?? entry.targetUserId;
      return {
        id: entry.id,
        at: formatDateTime(entry.at),
        label: actionLabel(entry.action),
        admin: entry.adminUserId === viewerId ? "Você" : shortId(entry.adminUserId),
        familyId: entry.targetHouseholdId,
        userId: entry.targetUserId,
        targetShort: target ? shortId(target) : null,
      };
    }),
    page,
    filters,
    hasNext: found.length > PAGE_SIZE,
    message: null,
  };
}
