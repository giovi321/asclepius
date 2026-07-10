import { useCallback, useEffect, useState } from "react";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
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
  Home,
  Move,
} from "lucide-react";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useConfirm } from "@/contexts/ConfirmContext";

// Hidden-folder rules live in lib/vaultHidden so the file browser and the
// DocumentViewer's "Pick file from vault" recovery picker show identical
// trees. ``config/`` at root, ``imaging-bundles/`` inside a patient.
import { ROOT_HIDDEN_FOLDERS, PATIENT_HIDDEN_FOLDERS } from "@/lib/vaultHidden";

interface TreeNode {
  name: string;
  type: "dir" | "file";
  path: string;
  size: number;
  children: TreeNode[];
}

/** DESIGN.md hover-affordance rule: row actions stay visible on phones and
 *  only become hover-revealed from md up (hover-capable layouts). */
const HOVER_REVEAL =
  "opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100";

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
  if (["pdf"].includes(ext))
    return <FileText className="h-4 w-4 text-destructive flex-shrink-0" />;
  if (["jpg", "jpeg", "png", "tiff", "tif"].includes(ext))
    return <Image className="h-4 w-4 text-info flex-shrink-0" />;
  if (["dcm", "dicom"].includes(ext))
    return <File className="h-4 w-4 text-cat-violet flex-shrink-0" />;
  return <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
}

function TreeItem({
  node,
  depth,
  filter,
  onDelete,
  onMove,
}: {
  node: TreeNode;
  depth: number;
  filter: string;
  onDelete: (path: string, name: string) => void;
  onMove: (path: string, name: string, isDir: boolean) => void;
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
        <div
          className="group flex min-h-9 coarse:min-h-11 items-center gap-1 rounded-md hover:bg-accent transition-colors"
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex flex-1 items-center gap-2 self-stretch rounded-md px-2 py-1.5 text-sm min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <FolderOpen className="h-4 w-4 text-warning flex-shrink-0" />
            <span className="font-medium truncate">{node.name}</span>
            <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">
              {node.children.length} item(s)
            </span>
          </button>
          <IconButton
            label="Move folder"
            size="sm"
            className={`mr-1 ${HOVER_REVEAL}`}
            onClick={(e) => {
              e.stopPropagation();
              onMove(node.path, node.name, true);
            }}
          >
            <Move className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                filter={filter}
                onDelete={onDelete}
                onMove={onMove}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="group flex min-h-9 coarse:min-h-11 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent transition-colors"
      style={{ paddingLeft: `${depth * 20 + 28}px` }}
    >
      {getFileIcon(node.name)}
      <span className="truncate">{node.name}</span>
      <span className="ml-auto flex items-center gap-1 flex-shrink-0">
        <span className="text-xs text-muted-foreground">
          {formatSize(node.size)}
        </span>
        <IconButton
          label="Move file"
          size="sm"
          className={HOVER_REVEAL}
          onClick={(e) => {
            e.stopPropagation();
            onMove(node.path, node.name, false);
          }}
        >
          <Move className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label="Delete file"
          size="sm"
          className={`hover:text-destructive hover:bg-destructive-soft active:bg-destructive-soft ${HOVER_REVEAL}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.path, node.name);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </span>
    </div>
  );
}

export default function FileBrowserPage() {
  const confirm = useConfirm();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [moveDialog, setMoveDialog] = useState<{
    path: string;
    name: string;
    isDir: boolean;
  } | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [moving, setMoving] = useState(false);

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
      setError(getErrorMessage(err, "Failed to load vault tree"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const handleDelete = async (path: string, name: string) => {
    const ok = await confirm({
      title: `Delete ${name}?`,
      description:
        "This will also remove the associated document record if one exists. This cannot be undone.",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete("/vault/file", { params: { path } });
      const currentPath =
        breadcrumb.length > 0 ? breadcrumb.join("/") : undefined;
      fetchTree(currentPath);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to delete file"));
    }
  };

  const openMoveDialog = (path: string, name: string, isDir: boolean) => {
    setMoveDialog({ path, name, isDir });
    setMoveTarget(path);
  };

  const handleMove = async () => {
    if (!moveDialog || !moveTarget || moveTarget === moveDialog.path) return;
    setMoving(true);
    setError(null);
    try {
      await api.post("/vault/move", {
        from_path: moveDialog.path,
        to_path: moveTarget,
      });
      setMoveDialog(null);
      setMoveTarget("");
      const currentPath =
        breadcrumb.length > 0 ? breadcrumb.join("/") : undefined;
      fetchTree(currentPath);
    } catch (err: any) {
      setError(getErrorMessage(err, "Move failed"));
    } finally {
      setMoving(false);
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
      {/* Filter + Refresh on the same row at the top */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Filter files..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant="secondary"
          size="md"
          className="flex-shrink-0"
          onClick={() =>
            fetchTree(breadcrumb.length > 0 ? breadcrumb.join("/") : undefined)
          }
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        <IconButton
          label="Vault root"
          size="sm"
          onClick={() => navigateToBreadcrumb(-1)}
        >
          <Home className="h-3.5 w-3.5" />
        </IconButton>
        {breadcrumb.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <button
              onClick={() => navigateToBreadcrumb(i)}
              className="inline-flex items-center rounded-md px-1 coarse:min-h-11 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {part}
            </button>
          </span>
        ))}
      </div>

      {/* Move dialog */}
      {moveDialog && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-medium flex items-center gap-2">
            <Move className="h-4 w-4" />
            Move <span className="font-mono break-all">{moveDialog.name}</span>
            {moveDialog.isDir ? " (folder)" : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Edit the destination path. The matching document record (and any
            child rows) will follow the file so existing references stay intact.
          </p>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">From</label>
            <Input value={moveDialog.path} readOnly className="bg-muted/30 font-mono" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">To</label>
            <Input
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              autoFocus
              className="font-mono"
              placeholder="patients/giovi/2026/20260101_consultation.pdf"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="md"
              onClick={handleMove}
              loading={moving}
              disabled={!moveTarget || moveTarget === moveDialog.path}
            >
              {moving ? "Moving..." : "Move"}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setMoveDialog(null);
                setMoveTarget("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive-soft p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Tree */}
      {loading ? (
        <div className="rounded-lg border bg-card">
          <SkeletonRows rows={8} cols={3} />
        </div>
      ) : tree ? (
        (() => {
          // Hide the app's plumbing folders. ROOT_HIDDEN_FOLDERS only when
          // browsing the vault root; PATIENT_HIDDEN_FOLDERS when browsing
          // inside a single patient directory (``patients/{slug}``).
          let visibleChildren = tree.children;
          if (breadcrumb.length === 0) {
            visibleChildren = tree.children.filter(
              (c) => !(c.type === "dir" && ROOT_HIDDEN_FOLDERS.has(c.name)),
            );
          } else if (breadcrumb.length === 2 && breadcrumb[0] === "patients") {
            visibleChildren = tree.children.filter(
              (c) => !(c.type === "dir" && PATIENT_HIDDEN_FOLDERS.has(c.name)),
            );
          }
          return (
            <div className="rounded-lg border bg-card">
              <div className="p-2">
                {visibleChildren.length === 0 ? (
                  <EmptyState
                    icon={FolderOpen}
                    title="No files found in vault"
                    description="Uploaded documents are filed here automatically once they are processed."
                  />
                ) : (
                  visibleChildren.map((child) => (
                    <TreeItem
                      key={child.path}
                      node={child}
                      depth={0}
                      filter={filter}
                      onDelete={handleDelete}
                      onMove={openMoveDialog}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })()
      ) : null}
    </div>
  );
}
