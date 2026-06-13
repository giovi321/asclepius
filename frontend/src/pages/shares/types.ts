export interface ShareSummary {
  id: number;
  patient_id: number;
  patient_name: string;
  /** Raw URL token. Null for shares created before the
   * token_clear column existed — those rows can't show a copy-link
   * button (admin must reissue if they need a new link). */
  token_clear: string | null;
  /** Server-built share link, decorated with ``share.public_base_url``
   * if set so split-host deployments hand the admin the doctor-facing
   * URL. Null when the row has no ``token_clear``. */
  share_url: string | null;
  recipient_label: string;
  recipient_contact: string;
  contact_kind: string;
  /** "manual" (legacy default) or "email". Email shares hide the
   * Show-active-code button because the OTP plaintext is never
   * persisted — there is nothing to show. */
  otp_delivery?: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  document_count: number;
  created_by_username: string;
  access_count: number;
  last_accessed_at: string | null;
}

export interface AuditEvent {
  id: number;
  action: string;
  session_id: string | null;
  document_id: number | null;
  client_ip: string | null;
  user_agent: string | null;
  detail: any;
  created_at: string;
}

export interface ActiveOtp {
  code: string;
  expires_at: string;
  attempts: number;
}

export interface ActiveSessionRow {
  rowid: number;
  share_id: number;
  expires_at: string;
  last_seen_at: string | null;
  client_ip: string | null;
  user_agent: string | null;
  created_at: string;
  /** True when the session has been silent past the idle timeout — the
   * queue treats it as a free slot but the row is not yet revoked. */
  is_idle: boolean;
}

export interface QueuedSessionRow {
  rowid: number;
  share_id: number;
  expires_at: string;
  client_ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface SessionsResponse {
  active: ActiveSessionRow[];
  queued: QueuedSessionRow[];
}

export type ShareStatus = "active" | "expired" | "revoked";

export const ALL_STATUSES: ShareStatus[] = ["active", "expired", "revoked"];
