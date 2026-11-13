import "server-only";
import { adminUserList, type AdminUserRow, type UserStatusFilter } from "@organizeup/db";
import { formatDate, formatDateTime, shortId } from "../format";

const PAGE_SIZE = 25;

export interface UserRow {
  id: string;
  name: string;
  email: string;
  shortId: string;
  createdAt: string;
  lastAccess: string;
  verified: boolean;
  blocked: boolean;
  households: number;
  owner: boolean;
}

export interface UsersState {
  rows: UserRow[];
  q: string;
  page: number;
  status: UserStatusFilter;
  hasNext: boolean;
  message: string | null;
}

const toRow = (row: AdminUserRow): UserRow => ({
  id: row.id,
  name: row.name,
  email: row.email,
  shortId: shortId(row.id),
  createdAt: formatDate(row.createdAt),
  lastAccess: row.lastAccessAt ? formatDateTime(row.lastAccessAt) : "Sem sessão",
  verified: row.emailVerified,
  blocked: row.blockedAt !== null,
  households: row.households,
  owner: row.isOwner,
});

export async function loadUsers(
  q: string,
  page: number,
  status: UserStatusFilter,
): Promise<UsersState> {
  const found = await adminUserList({
    limit: PAGE_SIZE + 1,
    offset: page * PAGE_SIZE,
    q,
    status,
  });
  return {
    rows: found.slice(0, PAGE_SIZE).map(toRow),
    q,
    page,
    status,
    hasNext: found.length > PAGE_SIZE,
    message: null,
  };
}
