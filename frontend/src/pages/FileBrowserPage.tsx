import { useCallback, useEffect, useState } from "react";
import api from "@/api/client";
import {
  FolderOpen,
  File,
  FileText,
  Image,
  Trash2,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
} from "lucide-react";

interface TreeNode {
  name: string;
  type: "dir" | "file";
  path: string;
  size: number;
  children: TreeNode[];
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function getFileIcon(name: string) {
  const ext = getFileExtension(name);
  if (["pdf"].includes(ext)) return <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />;
  if (["jpg", "jpeg", "png", "tiff", "tif"].includes(ext))
    return <Image className="h-4 w-4 text-blue-500 flex-shrink-0" />;
  if (["dcm", "dicom"].includes(ext))
    return <File className="h-4 w-4 text-purple-500 flex-shrink-0" />;
  return <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
}

function TreeItem({
  node,
  depth,
  filter,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  filter: string;
  onDelete: (path: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  // Filter: show if name matches or any child matches
  const matchesFilter = (n: TreeNode): boolean => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    if (n.name.toLowerCase().includes(q)) return true;
    if (n.type === "dir") return n.children.some(matchesFilter);
    return false;
  };

  if (!matchesFilter(node)) return null;

  if (node.type === "dir") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
          <FolderOpen className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <span className="font-medium truncate">{node.name}</span>
          <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">
            {node.children.length} item(s)
          </span>
        </button>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                filter={filter}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
      style={{ paddingLeft: `${depth * 20 + 28}px` }}
    >
      {getFileIcon(node.name)}
      <span className="truncate">{node.name}</span>
      <span className="ml-auto flex items-center gap-2 flex-shrink-0">
        <span className="text-xs text-muted-foreground">{formatSize(node.size)}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.path, node.name);
          }}
          className="opacity-0 group-hover:opacity-100 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
          title="Delete file"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}

export default function FileBrowserPage() {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ path: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);

  const fetchTree = useCallback(async (subpath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = subpath ? { path: subpath } : {};
      const res = await api.get("/vault/tree", { params });
      setTree(res.data);
      if (subpath) {
        setBreadcrumb(subpath.split("/").filter(Boolean));
      } else {
        setBreadcrumb([]);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load vault tree");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.delete("/vault/file", { params: { path: confirmDelete.path } });
      setConfirmDelete(null);
      // Refresh
      const currentPath = breadcrumb.length > 0 ? breadcrumb.join("/") : undefined;
      fetchTree(currentPath);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to delete file");
    } finally {
      setDeleting(false);
    }
  };

  const navigateToBreadcrumb = (index: number) => {
    if (index < 0) {
      fetchTree();
    } else {
      const path = breadcrumb.slice(0, index + 1).join("/");
      fetchTree(path);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button
          onClick={() => fetchTree(breadcrumb.length > 0 ? breadcrumb.join("/") : undefined)}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-1.5"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        <button
          onClick={() => navigateToBreadcrumb(-1)}
          className="hover:text-foreground hover:underline"
        >
          Vault
        </button>
        {breadcrumb.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <button
              onClick={() => navigateToBreadcrumb(i)}
              className="hover:text-foreground hover:underline"
            >
              {part}
            </button>
          </span>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter files..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded-md border bg-background pl-10 pr-3 py-2 text-sm"
        />
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm">
            Are you sure you want to delete <strong>{confirmDelete.name}</strong>?
            This will also remove the associated document record if one exists.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={() => setConfirmDelete(null)}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Tree */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : tree ? (
        <div className="rounded-lg border bg-card">
          <div className="p-2">
            {tree.children.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No files found in vault
              </p>
            ) : (
              tree.children.map((child) => (
                <TreeItem
                  key={child.path}
                  node={child}
                  depth={0}
                  filter={filter}
                  onDelete={(path, name) => setConfirmDelete({ path, name })}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
