import type { CertStatus } from "./api";

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function shortHash(h: string | null | undefined, n = 6): string {
  if (!h) return "";
  return `${h.slice(0, n + 2)}…${h.slice(-n)}`;
}

export const STATUS_LABEL: Record<CertStatus, string> = {
  PENDING: "Изчаква потвърждение",
  ISSUED: "Издаден",
  FAILED: "Неуспешен запис",
  REVOKED: "Отнет",
};
