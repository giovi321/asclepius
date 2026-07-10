import {
  AlertCircle,
  Clock,
  FileText,
  FolderTree,
  Heart,
  Image,
  LayoutDashboard,
  MessageCircle,
  Search,
  Settings,
  Share2,
  TestTube,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

/** Primary navigation, shared by the desktop SideNav and the mobile
 *  NavDrawer so the two can never drift. */
export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/patients", label: "Patients", icon: Users },
  { path: "/documents", label: "Documents", icon: FileText },
  { path: "/timeline", label: "Timeline", icon: Clock },
  { path: "/events", label: "Medical Events", icon: Heart },
  { path: "/unclassified", label: "Unclassified", icon: AlertCircle },
  { path: "/lab-results", label: "Lab Results", icon: TestTube },
  { path: "/imaging", label: "Imaging", icon: Image },
  { path: "/chat", label: "Chat", icon: MessageCircle },
  { path: "/search", label: "Search", icon: Search },
  { path: "/shares", label: "Doctor Shares", icon: Share2 },
];

/** Secondary destinations that live outside the main list. */
export const SECONDARY_NAV_ITEMS: NavItem[] = [
  { path: "/settings", label: "Settings", icon: Settings },
  { path: "/files", label: "Files", icon: FolderTree },
];

// Titles for every top-level route, including the ones that were moved
// out of the main nav but still exist as pages (Settings, Files).
const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/patients": "Patients",
  "/documents": "Documents",
  "/timeline": "Timeline",
  "/events": "Medical Events",
  "/unclassified": "Unclassified",
  "/lab-results": "Lab Results",
  "/imaging": "Imaging",
  "/chat": "Chat",
  "/search": "Search",
  "/shares": "Doctor Shares",
  "/settings": "Settings",
  "/files": "Files",
};

export function pageTitleFor(pathname: string): string {
  if (pathname === "/") return PAGE_TITLES["/"];
  // Longest-prefix match so /settings/analysis/providers still reads
  // "Settings" rather than falling through.
  const sorted = Object.keys(PAGE_TITLES)
    .filter((p) => p !== "/")
    .sort((a, b) => b.length - a.length);
  const match = sorted.find(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  return match ? PAGE_TITLES[match] : "";
}

export function isNavItemActive(path: string, pathname: string): boolean {
  return path === "/" ? pathname === "/" : pathname.startsWith(path);
}
