export default function StatusBadge({
  status,
}: {
  status: "active" | "expired" | "revoked";
}) {
  const map = {
    active:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    expired:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    revoked: "bg-muted text-muted-foreground line-through",
  };
  return (
    <span
      className={`inline-block rounded-md px-1.5 py-0.5 text-xs ${map[status]}`}
    >
      {status}
    </span>
  );
}
