import ShareLogo from "@/components/share/ShareLogo";

/**
 * Placeholder rendered on the public share host when no token is in the
 * URL (e.g. someone types ``med.example.com`` directly). The admin app
 * is unreachable from this hostname; we don't want to redirect to a
 * login form, but we also don't want to leak any product surface.
 *
 * Result: a dark page with a small centered logo. Anyone arriving here
 * by accident sees nothing actionable; anyone arriving with a real
 * share link goes straight to ``/share/{token}`` and never sees this.
 */
export default function ShareModeIdle() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-stone-950">
      <ShareLogo size="lg" />
    </div>
  );
}
