import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, Certificate, downloadFile } from "../api";
import { Alert, CopyButton, StatusBadge } from "../components/ui";
import { formatDate } from "../format";

export default function HolderPage() {
  const [items, setItems] = useState<Certificate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.certificates().then((r) => setItems(r.certificates)).catch((e) => setError(e instanceof ApiError ? e.message : "Грешка"));
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Моите сертификати</h1>
          <p className="muted">Изтеглете оригиналния PDF или изпратете линка за проверка на работодател. Променен файл не минава проверката.</p>
        </div>
      </header>
      {error && <Alert>{error}</Alert>}
      {items && items.length === 0 && <div className="empty"><p>Нямате издадени сертификати. Те се появяват тук, когато организация издаде сертификат на вашия имейл.</p></div>}
      <ul className="holder-list">
        {items?.map((c) => (
          <li key={c.id} className={`holder-item ${c.status === "REVOKED" ? "is-revoked" : ""}`}>
            <div className="holder-main">
              <div className="holder-org">{c.organizationName}</div>
              <h2><Link to={`/certificates/${c.id}`}>{c.title}: {c.program}</Link></h2>
              <div className="muted small">Рег. № {c.certificateNumber}, издаден на {formatDate(c.issueDate)}{c.grade ? `, оценка ${c.grade}` : ""}</div>
            </div>
            <div className="holder-actions">
              <StatusBadge status={c.status} />
              <button className="btn btn-primary btn-small" onClick={() => downloadFile(`/certificates/${c.id}/pdf`, `${c.certificateNumber}.pdf`)}>Изтегли PDF</button>
              <CopyButton value={c.verifyUrl} label="Копирай линка" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
