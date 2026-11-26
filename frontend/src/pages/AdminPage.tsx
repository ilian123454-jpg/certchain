import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, Certificate } from "../api";
import { Alert, Field, StatusBadge } from "../components/ui";
import { formatDate, formatDateTime, shortHash } from "../format";

const ACTION_LABEL: Record<string, string> = {
  LOGIN: "Вход",
  REGISTER: "Регистрация",
  ISSUER_CREATED: "Нов издател",
  ISSUER_DEACTIVATED: "Деактивиран издател",
  ISSUER_ACTIVATED: "Активиран издател",
  CERTIFICATE_ISSUED: "Издаден сертификат",
  CERTIFICATE_ISSUE_FAILED: "Неуспешен запис",
  CERTIFICATE_RECONCILED: "Синхронизиран статус",
  CERTIFICATE_REVOKED: "Отнет сертификат",
};

const RESULT_LABEL: Record<string, string> = { VALID: "Валиден", INVALID: "Невалиден", REVOKED: "Отнет", NOT_FOUND: "Не е намерен" };

type Tab = "overview" | "issuers" | "certificates" | "audit";

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<any>(null);
  const [issuers, setIssuers] = useState<any[]>([]);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ organizationName: "", fullName: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    api.stats().then(setStats).catch((e) => setError(e.message));
    api.issuers().then((r) => setIssuers(r.issuers)).catch(() => undefined);
    api.certificates().then((r) => setCerts(r.certificates)).catch(() => undefined);
    api.audit().then((r) => setAudit(r.entries)).catch(() => undefined);
  };
  useEffect(load, []);

  async function createIssuer(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.createIssuer(form);
      setNotice(`Издателят е създаден. Адрес в блокчейна: ${r.issuer.walletAddress}`);
      setForm({ organizationName: "", fullName: "", email: "", password: "" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Грешка");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(i: any) {
    setError(null);
    try {
      await api.setIssuerActive(i.id, !i.isActive);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Грешка");
    }
  }

  const db = stats?.database;
  const chain = stats?.blockchain;
  const maxDaily = Math.max(1, ...(stats?.daily ?? []).map((d: any) => Math.max(d.verifications, d.issued)));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Администрация</h1>
          {chain && (
            <p className={`node-state ${chain.available ? "ok" : "down"}`}>
              {chain.available ? `Блокчейн възелът работи, блок ${chain.blockNumber}` : "Блокчейн възелът е недостъпен"}
              {chain.contractAddress && <span className="mono small"> договор {shortHash(chain.contractAddress, 4)}</span>}
            </p>
          )}
        </div>
      </header>
      <div className="tabs" role="tablist">
        {(["overview", "issuers", "certificates", "audit"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : ""} onClick={() => setTab(t)}>
            {{ overview: "Обобщение", issuers: "Издатели", certificates: "Сертификати", audit: "Журнал" }[t]}
          </button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {tab === "overview" && db && (
        <>
          <div className="figures">
            <div><strong>{db.issued}</strong><span>валидни сертификата</span></div>
            <div><strong>{db.revoked}</strong><span>отнети</span></div>
            <div><strong>{db.issuers}</strong><span>активни издатели</span></div>
            <div><strong>{db.holders}</strong><span>притежатели</span></div>
            <div><strong>{chain?.totals?.issued ?? "?"}</strong><span>записа в договора</span></div>
          </div>
          {chain?.totals && chain.totals.issued !== db.issued + db.revoked && (
            <Alert kind="info">Броят записи в договора ({chain.totals.issued}) се различава от базата ({db.issued + db.revoked}). Възможно е договорът да съдържа записи от тестове или друга инсталация.</Alert>
          )}
          <div className="two-col">
            <section className="panel">
              <h2>Последните 7 дни</h2>
              <div className="bars" role="img" aria-label="Издадени сертификати и проверки по дни">
                {stats.daily.map((d: any) => (
                  <div className="bar-day" key={d.day}>
                    <div className="bar-pair">
                      <span className="bar bar-issued" style={{ height: `${(d.issued / maxDaily) * 100}%` }} title={`${d.issued} издадени`} />
                      <span className="bar bar-verif" style={{ height: `${(d.verifications / maxDaily) * 100}%` }} title={`${d.verifications} проверки`} />
                    </div>
                    <span className="bar-label">{d.day.slice(8)}.{d.day.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
              <p className="legend"><span className="key key-issued" /> издадени <span className="key key-verif" /> проверки</p>
            </section>
            <section className="panel">
              <h2>Проверки по резултат</h2>
              {stats.verifications.length === 0 && <p className="muted">Все още няма проверки.</p>}
              <table className="table compact">
                <tbody>
                  {stats.verifications.map((v: any) => (
                    <tr key={v.result}>
                      <td><span className={`dot dot-${v.result.toLowerCase()}`} />{RESULT_LABEL[v.result] ?? v.result}</td>
                      <td className="num">{v.count}</td>
                      <td className="num muted">{v.avgMs} ms средно</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}

      {tab === "issuers" && (
        <div className="two-col wide-left">
          <section className="panel">
            <h2>Издатели</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Организация</th><th>Адрес в блокчейна</th><th className="num">Издадени</th><th>Статус</th><th /></tr></thead>
                <tbody>
                  {issuers.map((i) => (
                    <tr key={i.id}>
                      <td><div>{i.organizationName}</div><div className="muted small">{i.fullName}, {i.email}</div></td>
                      <td className="mono small">{shortHash(i.walletAddress, 4)}</td>
                      <td className="num">{i.issuedCount}</td>
                      <td>{i.isActive ? <span className="badge badge-issued">Активен</span> : <span className="badge badge-revoked">Деактивиран</span>}</td>
                      <td><button className="btn btn-quiet btn-small" onClick={() => toggle(i)}>{i.isActive ? "Деактивирай" : "Активирай"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <form className="panel form" onSubmit={createIssuer}>
            <h2>Нов издател</h2>
            <p className="muted small">Системата създава нов блокчейн акаунт и му дава право да издава чрез смарт договора.</p>
            <Field label="Организация"><input value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} required /></Field>
            <Field label="Отговорно лице"><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></Field>
            <Field label="Имейл"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
            <Field label="Начална парола"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></Field>
            <button className="btn btn-primary" disabled={busy}>{busy ? "Записване в блокчейна…" : "Създай издател"}</button>
          </form>
        </div>
      )}

      {tab === "certificates" && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Рег. номер</th><th>Притежател</th><th>Издател</th><th>Дата</th><th>Статус</th></tr></thead>
            <tbody>
              {certs.map((c) => (
                <tr key={c.id}>
                  <td className="mono"><Link to={`/certificates/${c.id}`}>{c.certificateNumber}</Link></td>
                  <td>{c.holderName}</td>
                  <td>{c.organizationName}</td>
                  <td>{formatDate(c.issueDate)}</td>
                  <td><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "audit" && (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Време</th><th>Действие</th><th>Потребител</th><th>Детайли</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{formatDateTime(a.createdAt)}</td>
                  <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                  <td>{a.actorEmail ?? "система"}</td>
                  <td className="mono small">{a.details?.txHash ? `tx ${shortHash(a.details.txHash)}` : a.details?.reason ?? a.details?.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
