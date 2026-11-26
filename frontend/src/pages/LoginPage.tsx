import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { homeFor, useAuth } from "../auth";
import { Alert, Field } from "../components/ui";

const DEMO = [
  { label: "Издател (ТУ-София)", email: "issuer@tu-sofia.local", password: "Issuer123!" },
  { label: "Притежател", email: "student@certchain.local", password: "Student123!" },
  { label: "Администратор", email: "admin@certchain.local", password: "Admin123!" },
];

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      navigate(homeFor(u.role));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Неуспешен вход");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Вход</h1>
        <p className="muted">За издатели, притежатели на сертификати и администратори. Проверката не изисква вход.</p>
        {error && <Alert>{error}</Alert>}
        <Field label="Имейл"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></Field>
        <Field label="Парола"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Влизане…" : "Влез"}</button>
        <p className="muted small">Нямате акаунт? <Link to="/register">Регистрация за притежатели</Link></p>
      </form>
      <aside className="demo-box">
        <h2>Демо акаунти</h2>
        <ul>
          {DEMO.map((d) => (
            <li key={d.email}>
              <button type="button" className="linklike" onClick={() => { setEmail(d.email); setPassword(d.password); }}>
                {d.label}
              </button>
              <span className="mono small">{d.email} / {d.password}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
