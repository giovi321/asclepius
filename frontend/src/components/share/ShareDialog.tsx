import { useEffect, useState } from "react";
import {
  Copy,
  Loader2,
  Trash2,
  Eye,
  EyeOff,
  Check,
  RefreshCw,
  Plus,
} from "lucide-react";

import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/contexts/ToastContext";
import { useLlmProviders, useOcrProviders, useSettings } from "@/hooks/data";
import Sheet from "@/components/ui/Sheet";
import ProviderSelect from "@/components/ui/ProviderSelect";
import type { ShareCreateRequest, ShareCreateResponse } from "@/types";

// Same shape as backend `_EMAIL_RE`; client-side guard so the user
// gets a hint before the round trip.
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

type OtpDelivery = "manual" | "email";

interface ShareSummary {
  id: number;
  patient_id: number;
  recipient_label: string;
  recipient_contact: string;
  contact_kind: string;
  otp_delivery?: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  document_count: number;
  created_by_username: string;
}

// Server response for POST /shares — aliased from the generated schema so
// a backend field rename surfaces here at compile time.
type CreateResult = ShareCreateResponse;

interface ActiveOtp {
  code: string;
  expires_at: string;
  attempts: number;
}

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  patientId: number | null;
  documentIds: number[];
  patientName?: string | null;
  /** Free-form text describing what's being shared. */
  selectionLabel?: string;
}

/**
 * Reusable share-creation modal. Single-doc and multi-doc callers both
 * route through this — the only difference is how many ids land in
 * ``documentIds``. Backend validates same-patient + admin/owner role.
 *
 * Lists existing shares for the same patient under the create form so
 * the admin can revoke or reveal an active OTP without context-switching.
 */
export default function ShareDialog({
  open,
  onClose,
  patientId,
  documentIds,
  patientName,
  selectionLabel,
}: ShareDialogProps) {
  const { toast } = useToast();
  const [recipientLabel, setRecipientLabel] = useState("");
  const [recipientContact, setRecipientContact] = useState("");
  const [otpDelivery, setOtpDelivery] = useState<OtpDelivery>("manual");
  const [days, setDays] = useState(7);
  const [ocrProviderId, setOcrProviderId] = useState("");
  const [llmProviderId, setLlmProviderId] = useState("");
  const { data: llmData } = useLlmProviders();
  const { data: ocrData } = useOcrProviders();
  const { data: settingsData } = useSettings();
  const smtpEnabled = !!settingsData?.smtp?.enabled;
  const llmOptions = (Array.isArray(llmData) ? llmData : []).filter(
    (p: any) => p.enabled,
  );
  const ocrOptions = (Array.isArray(ocrData) ? ocrData : []).filter(
    (p: any) => p.enabled,
  );
  const [submitting, setSubmitting] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [activeOtps, setActiveOtps] = useState<
    Record<number, ActiveOtp | null>
  >({});
  const [revealOtp, setRevealOtp] = useState<Record<number, boolean>>({});
  const [loadingOtp, setLoadingOtp] = useState<Record<number, boolean>>({});

  const refresh = async () => {
    if (!patientId) return;
    try {
      const res = await api.get<ShareSummary[]>("/shares", {
        params: { patient_id: patientId },
      });
      setShares(res.data);
    } catch {
      // ignore; existing-shares list is informational
    }
  };

  useEffect(() => {
    if (open && patientId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId]);

  // Reset transient state when the dialog reopens for a different selection.
  useEffect(() => {
    if (!open) {
      setCreateResult(null);
      setRecipientLabel("");
      setRecipientContact("");
      setOtpDelivery("manual");
      setTokenCopied(false);
      setOcrProviderId("");
      setLlmProviderId("");
    }
  }, [open]);

  const onCreate = async () => {
    if (!patientId || documentIds.length === 0) return;
    // Client-side guard so the user gets a clear error before the round
    // trip. The backend re-validates with the same regex.
    if (otpDelivery === "email" && !EMAIL_RE.test(recipientContact.trim())) {
      toast({
        title: "Email OTP delivery needs a valid email in Contact",
        variant: "error",
      });
      return;
    }
    setSubmitting(true);
    try {
      const payload: ShareCreateRequest = {
        patient_id: patientId,
        document_ids: documentIds,
        recipient_label: recipientLabel.trim() || "Outside doctor",
        recipient_contact: recipientContact.trim() || "manual",
        expires_in_days: days,
        otp_delivery: otpDelivery,
        // Empty string from the <select>'s "Default" option becomes
        // null on the wire; the backend then falls through to the
        // first-enabled provider at translate time.
        default_ocr_provider_id: ocrProviderId || null,
        default_llm_provider_id: llmProviderId || null,
      };
      const res = await api.post<CreateResult>("/shares", payload);
      setCreateResult(res.data);
      refresh();
    } catch (err: any) {
      toast({
        title: "Could not create share",
        description: getErrorMessage(err),
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
        description: getErrorMessage(err),
        variant: "error",
      });
    }
  };

  // Add the current selection to an existing share for this patient.
  // This is how you build a share across several filter/search views:
  // select a subset, add it here, change the filter, open this dialog
  // again and add the next subset to the same share — the selection
  // never has to survive a filter change.
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const onAddToShare = async (shareId: number) => {
    if (documentIds.length === 0 || addingTo !== null) return;
    setAddingTo(shareId);
    try {
      const res = await api.post(`/shares/${shareId}/documents`, {
        document_ids: documentIds,
      });
      const added = res.data?.added ?? 0;
      const already = res.data?.already_present ?? 0;
      toast({
        title:
          added > 0
            ? `Added ${added} document${added === 1 ? "" : "s"} to the share`
            : "Those documents are already in this share",
        description:
          added > 0 && already > 0
            ? `${already} were already shared`
            : undefined,
        variant: "success",
      });
      refresh();
    } catch (err: any) {
      toast({
        title: "Could not add documents",
        description: getErrorMessage(err),
        variant: "error",
      });
    } finally {
      setAddingTo(null);
    }
  };

  const onRevealOtp = async (shareId: number) => {
    setLoadingOtp((s) => ({ ...s, [shareId]: true }));
    setRevealOtp((s) => ({ ...s, [shareId]: true }));
    try {
      // Lightweight endpoint — see SharesPage.onShowOtp comment.
      const res = await api.get(`/shares/${shareId}/active-otp`);
      setActiveOtps((s) => ({ ...s, [shareId]: res.data?.active_otp || null }));
    } catch (err: any) {
      toast({
        title: "Could not load OTP",
        description: getErrorMessage(err),
        variant: "error",
      });
      setRevealOtp((s) => ({ ...s, [shareId]: false }));
    } finally {
      setLoadingOtp((s) => ({ ...s, [shareId]: false }));
    }
  };

  const onCopyUrl = async () => {
    if (!createResult?.share_url) return;
    try {
      await navigator.clipboard.writeText(createResult.share_url);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1500);
    } catch {
      // best-effort; older browsers may block
    }
  };

  if (!open) return null;

  const docCountLabel =
    documentIds.length === 1
      ? selectionLabel || `Document #${documentIds[0]}`
      : `${documentIds.length} documents`;

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      dismissible={false}
      title="Share with doctor"
      contentClassName="sm:max-w-2xl"
    >
        <div className="space-y-4 text-sm">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="text-muted-foreground">Sharing:</div>
            <div className="font-medium">{docCountLabel}</div>
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
                  OTP delivery
                </label>
                <div className="flex flex-col gap-1.5 rounded-md border bg-background p-2.5">
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="radio"
                      name="otp_delivery"
                      value="manual"
                      checked={otpDelivery === "manual"}
                      onChange={() => setOtpDelivery("manual")}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">
                        I'll convey the code myself
                      </span>{" "}
                      <span className="text-muted-foreground">
                        — the OTP appears in this dashboard so you can read it
                        over the phone.
                      </span>
                    </span>
                  </label>
                  <label
                    className={`flex items-start gap-2 text-xs ${!smtpEnabled ? "opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name="otp_delivery"
                      value="email"
                      checked={otpDelivery === "email"}
                      onChange={() => setOtpDelivery("email")}
                      disabled={!smtpEnabled}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">
                        Email the code to the recipient
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {smtpEnabled
                          ? "— the OTP is sent automatically. You still send the link separately."
                          : "— configure SMTP in Settings → Email first."}
                      </span>
                    </span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {otpDelivery === "email"
                    ? "Recipient email (OTPs will be sent here)"
                    : "Contact (free-text, for your records only)"}
                </label>
                <input
                  type={otpDelivery === "email" ? "email" : "text"}
                  value={recipientContact}
                  onChange={(e) => setRecipientContact(e.target.value)}
                  placeholder={
                    otpDelivery === "email"
                      ? "doctor@example.com"
                      : "phone, email, or other identifier"
                  }
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
                  onChange={(e) => setDays(parseInt(e.target.value, 10) || 7)}
                  className="w-32 rounded-md border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              {/* Provider defaults — when the doctor clicks Translate
                  the backend uses these unless the request overrides
                  them. The doctor surface intentionally has no provider
                  picker, so the admin's choice here is final from the
                  doctor's point of view. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">
                    OCR provider for translation
                  </label>
                  <ProviderSelect
                    kind="ocr"
                    value={ocrProviderId}
                    onChange={setOcrProviderId}
                    options={ocrOptions}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    LLM provider for translation
                  </label>
                  <ProviderSelect
                    kind="llm"
                    value={llmProviderId}
                    onChange={setLlmProviderId}
                    options={llmOptions}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={onCreate}
                  disabled={
                    submitting || !patientId || documentIds.length === 0
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
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
                {otpDelivery === "email" ? (
                  <>
                    Send this link to the doctor. When they open it and request
                    a code, it will be emailed automatically to{" "}
                    <span className="font-mono">
                      {recipientContact || "(no recipient)"}
                    </span>
                    . The doctor will need a fresh code each session.
                  </>
                ) : (
                  <>
                    Send this link to the doctor. When they open it, they will
                    request a 6-digit code which you can read from the list
                    below and convey to them. The doctor will need a fresh code
                    each session.
                  </>
                )}
              </p>
            </div>
          )}

          {patientId && (
            <div className="border-t pt-4">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Existing shares for this patient
              </h3>
              {shares.length === 0 ? (
                <p className="text-xs text-muted-foreground">No shares yet.</p>
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
                          <div className="font-medium">{s.recipient_label}</div>
                          <div className="text-muted-foreground">
                            {s.document_count} doc
                            {s.document_count !== 1 ? "s" : ""} · expires{" "}
                            {s.expires_at} · {status}
                          </div>
                          {!isRevoked &&
                            !isExpired &&
                            s.otp_delivery === "email" && (
                              <div className="mt-1.5 text-xs text-muted-foreground italic">
                                Code emailed to{" "}
                                <span className="font-mono">
                                  {s.recipient_contact}
                                </span>
                                . The admin can't read it back.
                              </div>
                            )}
                          {!isRevoked &&
                            !isExpired &&
                            s.otp_delivery !== "email" && (
                              <div className="mt-1.5">
                                {revealOtp[s.id] ? (
                                  <div className="font-mono text-base tracking-widest text-primary">
                                    {loadingOtp[s.id] ? (
                                      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground italic font-sans tracking-normal">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Loading code...
                                      </span>
                                    ) : (
                                      activeOtps[s.id]?.code || (
                                        <span className="text-xs text-muted-foreground italic font-sans tracking-normal">
                                          No active code; ask the doctor to
                                          request one
                                        </span>
                                      )
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => onRevealOtp(s.id)}
                                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
                                  >
                                    <Eye className="h-3 w-3" /> Show active code
                                  </button>
                                )}
                                {revealOtp[s.id] && !loadingOtp[s.id] && (
                                  <div className="inline-flex items-center gap-1 ml-2">
                                    {activeOtps[s.id]?.code && (
                                      <CopyOtpInlineButton
                                        code={activeOtps[s.id]!.code}
                                      />
                                    )}
                                    <button
                                      onClick={() => onRevealOtp(s.id)}
                                      className="rounded p-0.5 hover:bg-accent"
                                      title="Refetch"
                                    >
                                      <RefreshCw className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() =>
                                        setRevealOtp((r) => ({
                                          ...r,
                                          [s.id]: false,
                                        }))
                                      }
                                      className="rounded p-0.5 hover:bg-accent"
                                      title="Hide"
                                    >
                                      <EyeOff className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {!isRevoked && !isExpired && documentIds.length > 0 && (
                            <button
                              onClick={() => onAddToShare(s.id)}
                              disabled={addingTo !== null}
                              className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-xs text-primary hover:bg-primary/5 disabled:opacity-50"
                              title={`Add the ${docCountLabel} to this share`}
                            >
                              {addingTo === s.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Plus className="h-3 w-3" />
                              )}
                              Add these
                            </button>
                          )}
                          {!isRevoked && (
                            <button
                              onClick={() => onRevoke(s.id)}
                              className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                              title="Revoke share"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
    </Sheet>
  );
}

function CopyOtpInlineButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // older browsers may block navigator.clipboard outside HTTPS
    }
  };
  return (
    <button
      onClick={onCopy}
      className="rounded p-0.5 hover:bg-accent"
      title={copied ? "Copied" : "Copy code"}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-600" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}
