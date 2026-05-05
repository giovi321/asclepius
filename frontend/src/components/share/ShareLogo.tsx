/**
 * Small Asclepius logo used across the doctor-share surface.
 *
 * Sizing presets keep usage consistent: ``sm`` for inline header
 * placement, ``md`` for landing/verify/waiting card headers, and
 * ``lg`` for the share-mode idle placeholder shown when someone hits
 * the public host without a token.
 */
type Size = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-6 w-6",
  md: "h-10 w-10",
  lg: "h-16 w-16",
};

export default function ShareLogo({ size = "sm" }: { size?: Size }) {
  return (
    <img
      src="/logo.svg"
      alt="Asclepius"
      className={`${SIZE_CLASSES[size]} select-none`}
      draggable={false}
    />
  );
}
