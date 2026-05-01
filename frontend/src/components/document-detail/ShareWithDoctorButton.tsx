import { useEffect, useState } from "react";
import {
  Copy,
  Loader2,
  Share2,
  Trash2,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";

import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";

interface ShareWithDoctorButtonProps {
  patientId: number | null;
  documentId: number;
  patientName?: string | null;
  documentLabel?: string | null;
}

interface ShareSummary {
  id: number;
  patient_id: number;
  recipient_label: string;
  recipient_contact: string;
  contact_kind: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  document_count: number;
  created_by_username: string;
}

interface CreateResult {
  share_id: number;
  share_url: string;
  expires_at: string;
}

interface ActiveOtp {
  code: string;
  expires_at: string;
  attempts: number;
}

/**
 * Admin-side dialog that creates a curated share for the current document
 * and lets the admin reveal the live OTP code so they can convey it to
 * the doctor by phone / in person.
 *
 * Designed to be drop-in: pass ``patientId`` and ``documentId`` and the
 * dialog handles the round-trips. Existing shares for the patient are
 * listed below the create form so the admin can revoke them.
 */
export default function ShareWithDoctorButton({
  patientId,
  documentId,
  patientName,
  documentLabel,
}: ShareWithDoctorButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [recipientLabel, setRecipientLabel] = useState("");
  const [recipientContact, setRecipientContact] = useState("");
  const [days, setDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [activeOtps, setActiveOtps] = useState<
    Record<number, ActiveOtp | null>
  >({});
  const [revealOtp, setRevealOtp] = useState<Record<number, boolean>>({});

  const refresh = async () => {
    if (!patientId) return;
    try {
      const res = await api.get<ShareSummary[]>("/shares", {
        params: { patient_id: patientId },
      });
      setShares(res.data);
    } catch {
      // ignore — show empty list
    }
  };

  useEffect(() => {
    if (open && patientId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId]);

  const onCreate = async () => {
    if (!patientId) return;
    setSubmitting(true);
    try {
      const res = await api.post<CreateResult>("/shares", {
        patient_id: patientId,
        document_ids: [documentId],
        recipient_label: recipientLabel.trim() || "Outside doctor",
        recipient_contact: recipientContact.trim() || "manual",
        expires_in_days: days,
      });
      setCreateResult(res.data);
      setRecipientLabel("");
      setRecipientContact("");
      refresh();
    } catch (err: any) {
      toast({
        title: "Could not create share",
        description: err?.response?.data?.detail || err.message,
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const onRevoke = async (id: number) => {
    try {
      await api.delete(`/shares/${id}`);
      toast({ title: "Share revoked", variant: "success" });
      refresh();
    } catch (err: any) {
      toast({
        title: "Revoke failed",
        description: err?.response?.data?.detail || err.message,
        variant: "error",
      });
    }
  };

  const onRevealOtp = async (shareId: number) => {
    try {
      const res = await api.get(`/shares/${shareId}/audit`, {
        params: { include_active_otp: true },
      });
      setActiveOtps((s) => ({ ...s, [shareId]: res.data?.active_otp || null }));
      setRevealOtp((s) => ({ ...s, [shareId]: true }));
    } catch (err: any) {
      toast({
        title: "Could not load OTP",
        description: err?.response?.data?.detail || err.message,
        variant: "error",
      });
    }
  };

  const onCopyUrl = async () => {
    if (!createResult?.share_url) return;
    try {
      await navigator.clipboard.writeText(createResult.share_url);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1500);
    } catch {
      // Best-effort — older browsers may block.
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!patientId}
        className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        title={
          patientId
            ? "Create a read-only doctor share for this document"
            : "Assign this document to a patient before sharing"
        }
      >
        <Share2 className="h-4 w-4" /> Share with doctor
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-card border shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="font-semibold">Share document with doctor</h2>
              <button
                onClick={() => {
                  setOpen(false);
                  setCreateResult(null);
                }}
                className="rounded p-1.5 hover:bg-accent"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 text-sm">
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <div className="text-muted-foreground">Sharing:</div>
                <div className="font-medium">
                  {documentLabel || `Document #${documentId}`}
                </div>
                {patientName && (
                  <div className="text-muted-foreground mt-0.5">
                    Patient: {patientName}
                  </div>
                )}
              </div>

              {!createResult && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Recipient name (shown on watermark + audit log)
                    </label>
                    <input
                      type="text"
                      value={recipientLabel}
                      onChange={(e) => setRecipientLabel(e.target.value)}
                      placeholder="e.g. Dr. Maria Rossi"
                      className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Contact (free-text, for your records only)
                    </label>
                    <input
                      type="text"
                      value={recipientContact}
                      onChange={(e) => setRecipientContact(e.target.value)}
                      placeholder="phone, email, or other identifier"
                      className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Expires after (days)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={days}
                      onChange={(e) =>
                        setDays(parseInt(e.target.value, 10) || 7)
                      }
                      className="w-32 rounded-md border bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={onCreate}
                      disabled={submitting || !patientId}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      {submitting && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      Create share link
                    </button>
                  </div>
                </div>
              )}

              {createResult && (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
                  <p className="text-xs font-medium text-primary">
                    Share created. Copy the link below; it is shown only once.
                  </p>
                  <div className="flex items-stretch gap-1.5">
                    <input
                      readOnly
                      value={createResult.share_url}
                      className="flex-1 rounded-md border bg-background px-3 py-1.5 font-mono text-xs"
                    />
                    <button
                      onClick={onCopyUrl}
                      className="inline-flex items-center gap-1 rounded-md border bg-background px-2 hover:bg-accent"
                      title="Copy"
                    >
                      {tokenCopied ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Send this link to the doctor. When they open it, they will
                    request a 6-digit code which you can read from the list
                    below and convey to them. The doctor will need a fresh code
                    each session.
                  </p>
                </div>
              )}

              {/* Existing shares for this patient */}
              {patientId && (
                <div className="border-t pt-4">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                    Existing shares for this patient
                  </h3>
                  {shares.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No shares yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {shares.map((s) => {
                        const isRevoked = !!s.revoked_at;
                        const isExpired =
                          !isRevoked && s.expires_at < new Date().toISOString();
                        const status = isRevoked
                          ? "revoked"
                          : isExpired
                            ? "expired"
                            : "active";
                        return (
                          <li
                            key={s.id}
                            className="rounded-md border bg-card px-3 py-2 text-xs flex items-start justify-between gap-3"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium">
                                {s.recipient_label}
                              </div>
                              <div className="text-muted-foreground">
                                {s.document_count} doc
                                {s.document_count !== 1 ? "s" : ""} · expires{" "}
                                {s.expires_at} · {status}
                              </div>
                              {!isRevoked && !isExpired && (
                                <div className="mt-1.5">
                                  {revealOtp[s.id] ? (
                                    <div className="font-mono text-base tracking-widest text-primary">
                                      {activeOtps[s.id]?.code || (
                                        <span className="text-xs text-muted-foreground italic">
                                          No active code; ask the doctor to
                                          request one
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => onRevealOtp(s.id)}
                                      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
                                    >
                                      <Eye className="h-3 w-3" /> Show active
                                      code
                                    </button>
                                  )}
                                  {revealOtp[s.id] && (
                                    <button
                                      onClick={() => {
                                        setRevealOtp((r) => ({
                                          ...r,
                                          [s.id]: false,
                                        }));
                                        onRevealOtp(s.id);
                                      }}
                                      className="ml-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
                                      title="Refetch active code"
                                    >
                                      <EyeOff className="h-3 w-3" /> Refresh
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                            {!isRevoked && (
                              <button
                                onClick={() => onRevoke(s.id)}
                                className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                                title="Revoke share"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
