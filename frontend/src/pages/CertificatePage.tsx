import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, ApiError, Certificate, downloadFile, fetchBlobUrl } from "../api";
import { useAuth } from "../auth";
import { Alert, CopyButton, Detail, Modal, StatusBadge } from "../components/ui";
import { formatDate, formatDateTime } from "../format";

export default function CertificatePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const [cert, setCert] = useState<Certificate | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>((location.state as any)?.justIssued ? "Сертификатът е издаден и записан в блокчейна." : null);
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.certificate(id).then((r) => setCert(r.certificate)).catch((e) => setError(e instanceof ApiError ? e.message : "Грешка"));
    let url: string | null = null;
    fetchBlobUrl(`/certificates/${id}/qr`).then((u) => setQr((url = u))).catch(() => undefined);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  if (error) return <div className="page"><Alert>{error}</Alert></div>;
  if (!cert) return <div className="page-loading">Зареждане…</div>;

  const canRevoke = cert.status === "ISSUED" && (user?.role === "ADMIN" || user?.role === "ISSUER");
  const back = user?.role === "ISSUER" ? "/issuer" : user?.role === "ADMIN" ? "/admin" : "/my";

  async function doRevoke() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.revoke(cert!.id, reason);
      setCert(r.certificate);
      setRevoking(false);
      setNotice("Сертификатът е отнет. Проверката вече показва статус „отнет“.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Неуспешно отнемане");
      setRevoking(false);
    } finally {
      setBusy(false);
    }
  }

  async function doRetry() {
    setBusy(true);
    try {
      const r = await api.retry(cert!.id);
      setCert(r.certificate);
      setNotice("Записът в блокчейна е успешен.");
    } catch (e) {
      setNotice(null);
      setError(e instanceof ApiError ? e.message : "Неуспешен опит");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <Link to={back} className="back">Назад към списъка</Link>
      <header className="page-head">
        <div>
          <h1>{cert.title} {cert.certificateNumber}</h1>
          <p className="muted">{cert.holderName}, {cert.program}</p>
        </div>
        <StatusBadge status={cert.status} />
      </header>
      {notice && <Alert kind="success">{notice}</Alert>}
      {cert.status === "FAILED" && (
        <Alert>
          Записът в блокчейна не е потвърден: {cert.errorMessage}
          {user?.role === "ISSUER" && <div><button className="btn btn-primary btn-small" onClick={doRetry} disabled={busy}>{busy ? "Опит…" : "Опитай отново"}</button></div>}
        </Alert>
      )}
      {cert.status === "REVOKED" && <Alert kind="info">Отнет на {formatDateTime(cert.revokedAt)}. Причина: {cert.revokeReason}</Alert>}

      <div className="cert-layout">
        <div>
          <dl className="details">
            <h3>Сертификат</h3>
            <Detail label="Притежател">{cert.holderName}</Detail>
            <Detail label="Имейл">{cert.holderEmail}</Detail>
            <Detail label="Програма">{cert.program}</Detail>
            {cert.grade && <Detail label="Оценка">{cert.grade}</Detail>}
            {cert.description && <Detail label="Текст">{cert.description}</Detail>}
            <Detail label="Дата на издаване">{formatDate(cert.issueDate)}</Detail>
            <Detail label="Издател">{cert.organizationName}, {cert.issuerName}</Detail>
          </dl>
          <dl className="details">
            <h3>Доказателство в блокчейна</h3>
            <Detail label="SHA-256 на PDF" mono>{cert.documentHash}</Detail>
            <Detail label="Идентификатор в договора" mono>{cert.chainId}</Detail>
            {cert.txHash && <Detail label="Транзакция" mono>{cert.txHash}</Detail>}
            {cert.blockNumber != null && <Detail label="Блок">{cert.blockNumber}</Detail>}
            {cert.revokeTxHash && <Detail label="Транзакция за отнемане" mono>{cert.revokeTxHash}</Detail>}
          </dl>
        </div>
        <aside className="cert-side">
          {qr && <img src={qr} alt="QR код за проверка" className="qr" />}
          <div className="mono small break">{cert.verifyUrl}</div>
          <div className="stack">
            <button className="btn btn-primary" onClick={() => downloadFile(`/certificates/${cert.id}/pdf`, `${cert.certificateNumber}.pdf`)} disabled={cert.status === "FAILED" || cert.status === "PENDING"}>Изтегли PDF</button>
            <CopyButton value={cert.verifyUrl} label="Копирай линка за проверка" />
            <Link to={`/verify/${cert.id}`} className="btn btn-quiet">Отвори проверката</Link>
            {canRevoke && <button className="btn btn-danger" onClick={() => setRevoking(true)}>Отнеми сертификата</button>}
          </div>
        </aside>
      </div>

      {revoking && (
        <Modal title="Отнемане на сертификат" onClose={() => setRevoking(false)}>
          <p>Отнемането се записва в блокчейна и не може да бъде отменено. Историята на сертификата се запазва.</p>
          <label className="field">
            <span className="field-label">Причина</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="напр. Грешно въведени данни" />
          </label>
          <div className="form-actions">
            <button className="btn btn-danger" disabled={busy || reason.trim().length < 5} onClick={doRevoke}>{busy ? "Записване…" : "Отнеми"}</button>
            <button className="btn btn-quiet" onClick={() => setRevoking(false)}>Отказ</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
