import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "../components/Layout";
import { Button, Card, Field, Input } from "../components/ui";
import { useAuth } from "../lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthPage({ mode }) {
  const isSignup = mode === "signup";
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);

  // after login, go back to the page that sent us here (ProtectedRoute stored it)
  const target = location.state?.from?.pathname || "/";
  if (user) return <Navigate to={target} replace />;

  function validate() {
    const e = {};
    if (!EMAIL_RE.test(email)) e.email = "Enter a valid email address";
    if (!password) e.password = "Enter your password";
    else if (isSignup && password.length < 8) e.password = "At least 8 characters";
    else if (isSignup && password.length > 72) e.password = "At most 72 characters";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    setServerError("");
    if (!validate()) return;
    setBusy(true);
    try {
      await (isSignup ? signup(email, password) : login(email, password));
      navigate(target, { replace: true });
    } catch (err) {
      setServerError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{isSignup ? "Create your account" : "Log in to Hostra"}</h1>
        <p className="mt-1 text-sm text-muted">
          {isSignup ? "Deploy apps from GitHub in seconds." : "Welcome back."}
        </p>
        <form onSubmit={submit} noValidate className="mt-6 space-y-4">
          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(errors.email)}
              placeholder="you@example.com"
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            error={errors.password}
            hint={isSignup ? "8 to 72 characters" : undefined}
          >
            <div className="relative">
              <Input
                id="password"
                type={show ? "text" : "password"}
                autoComplete={isSignup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(errors.password)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-faint hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          {serverError && (
            <p role="alert" className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-sm text-red-300">
              {serverError}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full justify-center" loading={busy}>
            {isSignup ? "Create account" : "Log in"}
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-sm text-muted">
        {isSignup ? "Already have an account? " : "No account yet? "}
        <Link
          to={isSignup ? "/login" : "/signup"}
          state={location.state}
          className="text-fg underline-offset-4 hover:underline"
        >
          {isSignup ? "Log in" : "Sign up"}
        </Link>
      </p>
    </div>
  );
}
