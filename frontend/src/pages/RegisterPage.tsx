import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Field } from "../components/ui";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form.fullName, form.email, form.password);
      navigate("/my");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Неуспешна регистрация");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Регистрация</h1>
        <p className="muted">Използвайте имейла, на който организацията е издала сертификата ви. Вече издадените сертификати ще се появят автоматично.</p>
        {error && <Alert>{error}</Alert>}
        <Field label="Име и фамилия"><input value={form.fullName} onChange={set("fullName")} required autoComplete="name" /></Field>
        <Field label="Имейл"><input type="email" value={form.email} onChange={set("email")} required autoComplete="email" /></Field>
        <Field label="Парола" hint="Поне 8 символа"><input type="password" value={form.password} onChange={set("password")} required minLength={8} autoComplete="new-password" /></Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Създаване…" : "Създай акаунт"}</button>
        <p className="muted small">Имате акаунт? <Link to="/login">Вход</Link></p>
      </form>
    </div>
  );
}
