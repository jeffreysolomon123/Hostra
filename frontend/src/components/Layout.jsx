import { ChevronDown, LogOut, Plus } from "lucide-react";
import { Component } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { EventsProvider, useEventsStatus } from "../lib/events";
import { Button, Dropdown, LiveIndicator, Skeleton } from "./ui";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 rounded font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 2 22 20H2Z" fill="currentColor" />
      </svg>
      Hostra
    </Link>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  const live = useEventsStatus();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Logo />
        <div className="flex-1" />
        <LiveIndicator status={live} className="hidden sm:inline-flex" />
        <Button as={Link} to="/new" variant="primary" size="sm">
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">New Project</span>
          <span className="sm:hidden">New</span>
        </Button>
        <Dropdown
          header={<span className="block max-w-56 truncate">{user.email}</span>}
          items={[{ label: "Log out", icon: LogOut, onSelect: logout }]}
          trigger={(props) => (
            <Button {...props} variant="ghost" size="sm" aria-label="User menu" className="px-1.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-zinc-500 to-zinc-800 text-[11px] font-semibold uppercase text-white">
                {user.email[0]}
              </span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        />
      </div>
    </header>
  );
}

/** Logged-in shell: one live events socket, the top bar, and the page. */
export function AppLayout() {
  return (
    <EventsProvider>
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </EventsProvider>
  );
}

/** Redirects to /login (remembering where you wanted to go) when logged out. */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-10" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

/** Catches render errors so one broken component does not blank the whole app. */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-md font-mono text-sm text-muted">{String(this.state.error.message || this.state.error)}</p>
        <Button variant="secondary" onClick={() => window.location.assign("/")}>
          Back to projects
        </Button>
      </div>
    );
  }
}
