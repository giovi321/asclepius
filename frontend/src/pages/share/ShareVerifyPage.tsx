import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { KeyRound } from "lucide-react";

import shareApi from "@/api/shareClient";
import ShareLogo from "@/components/share/ShareLogo";
import Button from "@/components/ui/Button";

type DeliveryInfo = {
  delivery: "manual" | "email";
};

/**
 * OTP verification step.
 *
 * Submits the 6-digit code to verify-otp. The backend either:
 *  - sets the ``asclepius_share`` session cookie and returns
 *    ``status: "active"`` — we hard-navigate to the dashboard so the
 *    new cookie is picked up by the next ``/api/share/me`` fetch, or
 *  - sets the ``asclepius_share_queue`` cookie and returns
 *    ``status: "queued"`` (HTTP 202) when another device is already
 *    using this share — we hard-navigate to ``/share/waiting`` so the
 *    polling state machine takes over.
 */
export default function ShareVerifyPage() {
  const { token } = useParams<{ token: string }>();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<DeliveryInfo | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    shareApi
      .get<DeliveryInfo>(`/${token}/info`)
      .then((res) => {
        if (!cancelled) setInfo(res.data);
      })
      .catch(() => {
        // Same fallback as the landing page — neutral copy.
        if (!cancelled) setInfo({ delivery: "manual" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const trimmed = code.trim();
    if (!/^\d{4,8}$/.test(trimmed)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await shareApi.post<{ status: "active" | "queued" }>(
        `/${token}/verify-otp`,
        { code: trimmed },
      );
      // Hard navigation so the new cookie is picked up by the next
      // page mount. Both status values navigate; the destination
      // depends on which cookie the server just set.
      if (res.data?.status === "queued") {
        window.location.href = "/share/waiting";
      } else {
        window.location.href = "/share/dashboard";
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setError("Invalid or expired code. Request a fresh one.");
      } else if (status === 429) {
        setError("Too many attempts. Wait and try again.");
      } else {
        setError("Verification failed. Please retry.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm space-y-6">
        <div className="flex justify-center">
          <ShareLogo size="md" />
        </div>
        <div className="flex items-center gap-2 text-primary">
          <KeyRound className="h-6 w-6" />
          <h1 className="text-lg font-semibold">Enter your access code</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {info?.delivery === "email"
            ? "Check your inbox for the 6-digit code we just sent. The code is valid for a limited time and can only be used once."
            : "Enter the 6-digit code provided to you. The code is valid for a limited time and can only be used once."}
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-center text-lg tracking-[0.4em] font-mono placeholder:text-muted-foreground transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            placeholder="000000"
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={submitting}
          >
            Verify and continue
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <p className="text-xs text-muted-foreground border-t pt-4">
          If your code was rejected, ask the sender to issue a new one.
        </p>
      </div>
    </div>
  );
}
