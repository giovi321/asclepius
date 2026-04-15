import { useEffect, useState } from "react";
import api from "@/api/client";
import { Plus, Trash2, ScrollText } from "lucide-react";

export default function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", display_name: "", role: "editor" });
  const [patients, setPatients] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [auditTotal, setAuditTotal] = useState(0);

  useEffect(() => {
    api.get("/settings/users").then((res) => setUsers(res.data)).catch(() => {});
    api.get("/patients").then((res) => setPatients(Array.isArray(res.data) ? res.data : [])).catch(() => {});
  }, []);

  const loadAuditLog = async () => {
    try {
      const res = await api.get("/settings/audit-log", { params: { limit: 100 } });
      setAuditLog(res.data.items || []);
      setAuditTotal(res.data.total || 0);
    } catch { setAuditLog([]); }
  };

  const createUser = async () => {
    await api.post("/settings/users", newUser);
    setNewUser({ username: "", password: "", display_name: "", role: "editor" });
    setShowCreate(false);
    const res = await api.get("/settings/users");
    setUsers(res.data);
  };

  const deleteUser = async (id: number) => {
    if (!confirm("Delete this user?")) return;
    await api.delete(`/settings/users/${id}`);
    setUsers(users.filter((u) => u.id !== id));
  };

  const updateRole = async (userId: number, role: string) => {
    await api.patch(`/settings/users/${userId}`, { role });
    setUsers(users.map((u) => u.id === userId ? { ...u, role } : u));
  };

  const grantAccess = async (userId: number, patientId: number) => {
    await api.post(`/settings/users/${userId}/access`, { patient_id: patientId, role: "viewer" });
  };

  const roleColor = (role: string) => {
    switch (role) {
      case "admin": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      case "editor": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "viewer": return "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">User Management</h3>
        <div className="flex gap-2">
          <button onClick={() => { setShowAudit(!showAudit); if (!showAudit) loadAuditLog(); }}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            <ScrollText className="h-4 w-4" /> {showAudit ? "Hide Audit Log" : "Audit Log"}
          </button>
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add User
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="rounded-lg border p-4 space-y-3 max-w-md">
          <input type="text" placeholder="Username" value={newUser.username}
            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <input type="password" placeholder="Password" value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <input type="text" placeholder="Display Name" value={newUser.display_name}
            onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm">
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button onClick={createUser} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Create</button>
        </div>
      )}

      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
        <p><strong>Admin:</strong> Full access — settings, user management, all patients.</p>
        <p><strong>Editor:</strong> Can view/edit documents and patients they have access to.</p>
        <p><strong>Viewer:</strong> Read-only access to assigned patients.</p>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Username</th>
              <th className="px-4 py-2 text-left font-medium">Display Name</th>
              <th className="px-4 py-2 text-left font-medium">Role</th>
              <th className="px-4 py-2 text-left font-medium">Created</th>
              <th className="px-4 py-2 text-left font-medium">Grant Access</th>
              <th className="px-4 py-2 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium">{u.username}</td>
                <td className="px-4 py-2">{u.display_name}</td>
                <td className="px-4 py-2">
                  <select value={u.role || "editor"}
                    onChange={(e) => updateRole(u.id, e.target.value)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium border-0 cursor-pointer ${roleColor(u.role || "editor")}`}>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{u.created_at?.split("T")[0]}</td>
                <td className="px-4 py-2">
                  <select className="rounded border bg-background px-2 py-1 text-xs" defaultValue=""
                    onChange={(e) => { if (e.target.value) grantAccess(u.id, Number(e.target.value)); e.target.value = ""; }}>
                    <option value="">Grant patient...</option>
                    {patients.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <button onClick={() => deleteUser(u.id)} className="rounded p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Audit Log */}
      {showAudit && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Audit Log</h3>
            <span className="text-xs text-muted-foreground">{auditTotal} total entries</span>
          </div>
          <div className="rounded-lg border max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Time</th>
                  <th className="px-3 py-2 text-left font-medium">User</th>
                  <th className="px-3 py-2 text-left font-medium">Action</th>
                  <th className="px-3 py-2 text-left font-medium">Resource</th>
                  <th className="px-3 py-2 text-left font-medium">Details</th>
                  <th className="px-3 py-2 text-left font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {auditLog.length === 0 ? (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No audit log entries</td></tr>
                ) : auditLog.map((entry) => (
                  <tr key={entry.id} className="hover:bg-accent/20">
                    <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{entry.created_at?.replace("T", " ").slice(0, 19)}</td>
                    <td className="px-3 py-1.5 font-medium">{entry.username || `#${entry.user_id}`}</td>
                    <td className="px-3 py-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{entry.action}</span>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {entry.resource_type && `${entry.resource_type}`}
                      {entry.resource_id && ` #${entry.resource_id}`}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground max-w-[200px] truncate">{entry.details}</td>
                    <td className="px-3 py-1.5 text-muted-foreground font-mono">{entry.ip_address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
