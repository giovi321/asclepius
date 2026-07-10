import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";

import shareApi from "@/api/shareClient";
import ShareLogo from "@/components/share/ShareLogo";
import Button from "@/components/ui/Button";

type DeliveryInfo = {
  delivery: "manual" | "email";
};

/**
 * Entry point for a share link.
 *
 * On mount we hit the public ``/info`` endpoint to learn whether this
 * share delivers its OTP via email or asks the admin to convey it
 * manually — the copy on the page and the post-submit redirect both
 * adapt to that. The endpoint returns the same shape for an invalid
 * token as for a valid manual share, so this fetch only reveals that
 * the share is email-delivery vs not. The recipient address is never
 * surfaced — neither here nor in the endpoint response — so a shoulder-
 * surfer cannot learn the doctor's mailbox from the landing page.
 *
 * Clicking "Request access code" calls request-otp. For email shares
 * the server dispatches an SMTP message synchronously; a 502 here
 * means SMTP itself failed (server unreachable, rejected envelope,
 * etc.) and the doctor should ask the practice to switch the share
 * to manual delivery.
 */
export default function ShareLandingPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
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
        // Network glitch — fall back to neutral copy. The verify step
        // will still work either way.
        if (!cancelled) setInfo({ delivery: "manual" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      await shareApi.post(`/${token}/request-otp`);
      navigate(`/share/${token}/verify`);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 429) {
        setError("Too many requests. Please wait a few minutes and try again.");
      } else if (status === 502) {
        // Email delivery failed at the SMTP layer. The OTP was not
        // sent and there is nothing the doctor can do — they need to
        // ask the practice to switch this share to manual delivery.
        setError(
          "Could not deliver the access code by email. " +
            "Please ask the person who shared this link with you " +
            "to switch this share to manual delivery.",
        );
      } else {
        setError("Could not request a code. Please retry.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Copy varies by delivery method. While ``info`` is loading we show
  // a neutral string so the page is never blank. The recipient address
  // is intentionally NOT shown — the doctor knows where their mailbox
  // is, and printing it on the landing page would let a shoulder-surfer
  // or anyone who opens the URL on a shared computer learn it.
  let bodyCopy: string;
  if (info?.delivery === "email") {
    bodyCopy =
      "You have been invited to view a curated set of medical documents. " +
      "Click below and we will email you a 6-digit access code at the " +
      "address your contact has on file for you.";
  } else {
    bodyCopy =
      "You have been invited to view a curated set of medical documents. " +
      "To continue, request a 6-digit access code. The person who shared " +
      "this link with you will tell you the code directly.";
  }

  const buttonLabel =
    info?.delivery === "email" ? "Email me a code" : "Request access code";

  return (
    <div className="min-h-dvh flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm space-y-6">
        <div className="flex justify-center">
          <ShareLogo size="md" />
        </div>
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="h-6 w-6" />
          <h1 className="text-lg font-semibold">Secure document share</h1>
        </div>
        <p className="text-sm text-muted-foreground">{bodyCopy}</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={submitting}
            disabled={!token}
          >
            {buttonLabel}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <p className="text-xs text-muted-foreground border-t pt-4">
          Sessions expire automatically. The documents are read-only and cannot
          be downloaded or modified.
        </p>
      </div>
    </div>
  );
}
