import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * Persistent app shell: fixed 240px sidebar, fixed 56px top bar, fluid main.
 * Sidebar and top bar never scroll; only the main content area does, so long
 * file paths and command text can never push the chrome around.
 */
export function AppShell() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
