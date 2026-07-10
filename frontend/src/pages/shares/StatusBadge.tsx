export default function StatusBadge({
  status,
}: {
  status: "active" | "expired" | "revoked";
}) {
  const map = {
    active: "bg-success-soft text-success",
    expired: "bg-warning-soft text-warning",
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
