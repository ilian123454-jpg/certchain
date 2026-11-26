export type Role = "ADMIN" | "ISSUER" | "HOLDER";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  organizationName: string | null;
  walletAddress: string | null;
}

export type CertStatus = "PENDING" | "ISSUED" | "FAILED" | "REVOKED";

export interface Certificate {
  id: string;
  certificateNumber: string;
  chainId: string;
  holderName: string;
  holderEmail: string;
  title: string;
  program: string;
  description: string | null;
  grade: string | null;
  issueDate: string;
  organizationName: string;
  issuerName: string;
  documentHash: string;
  status: CertStatus;
  txHash: string | null;
  blockNumber: number | null;
  errorMessage: string | null;
  revokeReason: string | null;
  revokedAt: string | null;
  revokeTxHash: string | null;
  createdAt: string;
  verifyUrl: string;
}

export type VerificationResult = "VALID" | "INVALID" | "NOT_FOUND" | "REVOKED";

export interface Verification {
  result: VerificationResult;
  reason: string;
  message: string;
  documentHash?: string;
  checkedAt: string;
  certificate: null | {
    id: string;
    certificateNumber: string;
    holderName: string;
    title: string;
    program: string;
    grade: string | null;
    issueDate: string;
    organizationName: string;
    status: CertStatus;
    revokeReason: string | null;
    txHash: string | null;
    blockNumber: number | null;
  };
  chain: null | {
    certificateId: string;
    contractAddress: string;
    documentHash: string;
    issuer: string;
    issuerName: string;
    issuedAt: string | null;
    revokedAt: string | null;
    status: "VALID" | "REVOKED";
  };
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: any) {
    super(message);
  }
}

const TOKEN_KEY = "certchain.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* браузърът блокира localStorage */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Сървърът не отговаря. Проверете връзката и опитайте отново.");
  }
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event("certchain:logout"));
  }
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    const err = body?.error;
    const detail = err?.details && Array.isArray(err.details) ? ": " + err.details.map((d: any) => d.message).join("; ") : "";
    throw new ApiError(res.status, (err?.message ?? `Грешка ${res.status}`) + detail, err?.code, err?.details);
  }
  return body as T;
}

export const api = {
  login: (email: string, password: string) => request<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (fullName: string, email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/register", { method: "POST", body: JSON.stringify({ fullName, email, password }) }),
  me: () => request<{ user: User }>("/auth/me"),

  certificates: (q = "") => request<{ certificates: Certificate[] }>(`/certificates${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  certificate: (id: string) => request<{ certificate: Certificate }>(`/certificates/${id}`),
  issue: (data: Record<string, string>) => request<{ certificate: Certificate }>("/certificates", { method: "POST", body: JSON.stringify(data) }),
  revoke: (id: string, reason: string) => request<{ certificate: Certificate }>(`/certificates/${id}/revoke`, { method: "POST", body: JSON.stringify({ reason }) }),
  retry: (id: string) => request<{ certificate: Certificate }>(`/certificates/${id}/retry`, { method: "POST" }),

  verifyId: (id: string) => request<Verification>(`/verify/${encodeURIComponent(id)}`),
  verifyFile: (file: File, certificateId?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (certificateId) fd.append("certificateId", certificateId);
    return request<Verification>("/verify/file", { method: "POST", body: fd });
  },

  stats: () => request<any>("/admin/stats"),
  issuers: () => request<{ issuers: any[] }>("/admin/issuers"),
  createIssuer: (data: Record<string, string>) => request<any>("/admin/issuers", { method: "POST", body: JSON.stringify(data) }),
  setIssuerActive: (id: string, isActive: boolean) => request<any>(`/admin/issuers/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
  audit: () => request<{ entries: any[] }>("/admin/audit"),
};

/** Изтегля защитен файл (PDF/QR) с токена и го предлага за запис. */
export async function downloadFile(path: string, filename: string) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) throw new ApiError(res.status, "Файлът не може да бъде изтеглен");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fetchBlobUrl(path: string): Promise<string> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) throw new ApiError(res.status, "Неуспешно зареждане");
  return URL.createObjectURL(await res.blob());
}
