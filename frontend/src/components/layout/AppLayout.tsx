import { Suspense, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import SideNav from "@/components/layout/SideNav";
import NavDrawer from "@/components/layout/NavDrawer";
import TopBar from "@/components/layout/TopBar";
import { pageTitleFor } from "@/components/layout/nav";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { useBreakpoint } from "@/hooks/useMediaQuery";

const SIDEBAR_KEY = "asclepius:sidebar-collapsed";

/** Suspense fallback for lazy pages: the shell stays put, the content area
 *  shows placeholder blocks instead of flashing blank. */
function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-8 w-48" />
      <SkeletonRows rows={6} cols={4} className="rounded-lg border" />
    </div>
  );
}

/**
 * The authed app shell.
 *
 * Two independent navigation states:
 *  - drawerOpen: the mobile overlay drawer; ephemeral, starts closed (the
 *    old shared boolean started the 256px sidebar OPEN on phones, leaving
 *    ~134px of content), and closes on every route change.
 *  - sidebarCollapsed: the desktop rail; persisted across sessions.
 *
 * `main` is the app's one scroll container (h-dvh keeps it honest under
 * mobile URL-bar collapse), with per-history-entry scroll restoration.
 */
export default function AppLayout() {
  const location = useLocation();
  const { isDesktop } = useBreakpoint();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "1",
  );
  const mainRef = useRef<HTMLElement>(null);
  useScrollRestoration(mainRef);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      localStorage.setItem(SIDEBAR_KEY, prev ? "0" : "1");
      return !prev;
    });
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <SideNav collapsed={sidebarCollapsed} className="hidden lg:flex" />
      {!isDesktop && (
        <NavDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={pageTitleFor(location.pathname)}
          onOpenDrawer={() => setDrawerOpen(true)}
          onToggleSidebar={toggleSidebar}
        />
        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto overscroll-contain p-4 pb-safe sm:p-6"
        >
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
