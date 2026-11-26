import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, Certificate } from "../api";
import { useAuth } from "../auth";
import { Alert, StatusBadge } from "../components/ui";
import { formatDate } from "../format";

export default function IssuerPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Certificate[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.certificates(q).then((r) => setItems(r.certificates)).catch((e) => setError(e instanceof ApiError ? e.message : "Грешка"));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const counts = items ? { issued: items.filter((c) => c.status === "ISSUED").length, revoked: items.filter((c) => c.status === "REVOKED").length, failed: items.filter((c) => c.status === "FAILED").length } : null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Издадени сертификати</h1>
          <p className="muted">{user?.organizationName}</p>
        </div>
        <Link to="/issuer/new" className="btn btn-primary">Издай сертификат</Link>
      </header>

      {counts && (
        <p className="summary-line">
          <strong>{counts.issued}</strong> валидни, <strong>{counts.revoked}</strong> отнети
          {counts.failed > 0 && <>, <strong className="text-danger">{counts.failed}</strong> чакат повторен опит</>}
        </p>
      )}

      <input className="search" type="search" placeholder="Търсене по име, имейл, номер или програма" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Търсене" />
      {error && <Alert>{error}</Alert>}

      {items && items.length === 0 && (
        <div className="empty">
          <p>Все още няма издадени сертификати{q ? " по това търсене" : ""}.</p>
          {!q && <Link to="/issuer/new" className="btn btn-primary">Издай първия</Link>}
        </div>
      )}

      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Рег. номер</th>
                <th>Притежател</th>
                <th>Програма</th>
                <th>Дата</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/certificates/${c.id}`)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate(`/certificates/${c.id}`)}>
                  <td className="mono">{c.certificateNumber}</td>
                  <td>
                    <div>{c.holderName}</div>
                    <div className="muted small">{c.holderEmail}</div>
                  </td>
                  <td>{c.program}</td>
                  <td>{formatDate(c.issueDate)}</td>
                  <td><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
