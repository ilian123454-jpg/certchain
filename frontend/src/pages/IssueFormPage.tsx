import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { Alert, Field } from "../components/ui";

const today = () => new Date().toISOString().slice(0, 10);

export default function IssueFormPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ holderName: "", holderEmail: "", title: "Сертификат", program: "", grade: "", description: "", issueDate: today() });
  const [error, setError] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFailedId(null);
    try {
      const payload: Record<string, string> = { ...form };
      if (!payload.grade) delete payload.grade;
      if (!payload.description) delete payload.description;
      const r = await api.issue(payload);
      navigate(`/certificates/${r.certificate.id}`, { state: { justIssued: true } });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details?.certificate?.id) setFailedId(err.details.certificate.id);
      } else setError("Неуспешно издаване");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Нов сертификат</h1>
          <p className="muted">След издаване системата генерира PDF с QR код, изчислява SHA-256 хеша му и го записва в блокчейна.</p>
        </div>
      </header>
      {error && (
        <Alert>
          {error}
          {failedId && (
            <div>
              Сертификатът е запазен със статус „Неуспешен запис“. <button type="button" className="linklike" onClick={() => navigate(`/certificates/${failedId}`)}>Отвори го</button>, за да опитате отново.
            </div>
          )}
        </Alert>
      )}
      <form className="form" onSubmit={onSubmit}>
        <fieldset>
          <legend>Притежател</legend>
          <div className="grid-2">
            <Field label="Име и фамилия"><input value={form.holderName} onChange={set("holderName")} required minLength={3} /></Field>
            <Field label="Имейл" hint="Притежателят вижда сертификата, когато влезе с този имейл"><input type="email" value={form.holderEmail} onChange={set("holderEmail")} required /></Field>
          </div>
        </fieldset>
        <fieldset>
          <legend>Сертификат</legend>
          <div className="grid-2">
            <Field label="Вид документ">
              <select value={form.title} onChange={set("title")}>
                <option>Сертификат</option>
                <option>Удостоверение</option>
                <option>Диплома</option>
                <option>Свидетелство</option>
              </select>
            </Field>
            <Field label="Дата на издаване"><input type="date" value={form.issueDate} max={today()} onChange={set("issueDate")} required /></Field>
          </div>
          <Field label="Курс или програма"><input value={form.program} onChange={set("program")} required minLength={3} placeholder="напр. Блокчейн технологии и смарт договори" /></Field>
          <div className="grid-2">
            <Field label="Оценка (по избор)"><input value={form.grade} onChange={set("grade")} placeholder="напр. Отличен 6.00" /></Field>
          </div>
          <Field label="Допълнителен текст (по избор)"><textarea rows={3} value={form.description} onChange={set("description")} maxLength={1000} /></Field>
        </fieldset>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? "Записване в блокчейна…" : "Издай и запиши в блокчейна"}</button>
          <button type="button" className="btn btn-quiet" onClick={() => navigate("/issuer")}>Отказ</button>
        </div>
      </form>
    </div>
  );
}
