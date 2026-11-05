import { Link } from "react-router-dom";
import { Button } from "../components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-sm text-faint">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page could not be found</h1>
      <p className="mt-2 text-sm text-muted">The link may be broken, or the page was removed.</p>
      <Button as={Link} to="/" variant="primary" className="mt-6">
        Back to projects
      </Button>
    </div>
  );
}
