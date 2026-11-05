import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppLayout, ErrorBoundary, ProtectedRoute } from "./components/Layout";
import { Skeleton } from "./components/ui";
import AuthPage from "./pages/AuthPage";
import NewProject from "./pages/NewProject";
import NotFound from "./pages/NotFound";
import Projects from "./pages/Projects";
import DeploymentDetail from "./pages/project/DeploymentDetail";
import Deployments from "./pages/project/Deployments";
import Environment from "./pages/project/Environment";
import Logs from "./pages/project/Logs";
import Overview from "./pages/project/Overview";
import ProjectLayout from "./pages/project/ProjectLayout";
import Settings from "./pages/project/Settings";

// recharts is most of the bundle; only load it when the Metrics tab is opened
const Metrics = lazy(() => import("./pages/project/Metrics"));
const metrics = (
  <Suspense fallback={<Skeleton className="h-64" />}>
    <Metrics />
  </Suspense>
);

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<Projects />} />
            <Route path="new" element={<NewProject />} />
            <Route path="projects/:name" element={<ProjectLayout />}>
              <Route index element={<Overview />} />
              <Route path="deployments" element={<Deployments />} />
              <Route path="deployments/:id" element={<DeploymentDetail />} />
              <Route path="logs" element={<Logs />} />
              <Route path="metrics" element={metrics} />
              <Route path="env" element={<Environment />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
