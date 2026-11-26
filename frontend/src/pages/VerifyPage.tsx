import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, Verification } from "../api";
import { Verdict } from "../components/Verdict";
import { Alert } from "../components/ui";

export default function VerifyPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(id ?? "");
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) {
      setResult(null);
      return;
    }
    setCode(id);
    run(() => api.verifyId(id));
  }, [id]);

  async function run(fn: () => Promise<Verification>) {
    setBusy(true);
    setError(null);
    try {
      setResult(await fn());
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e.message : "Проверката не може да бъде извършена.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = code.trim().replace(/^.*\/verify\//, "");
    if (!value) return;
    if (value === id) run(() => api.verifyId(value));
    else navigate(`/verify/${value}`);
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    run(() => api.verifyFile(file, id));
  }

  // При отваряне от QR код резултатът е най-отгоре, защото на телефон това е първото, което човек търси.
  const outcome = (
    <div className="verify-outcome">
      {busy && <div className="verify-busy" role="status">Проверка в блокчейна…</div>}
      {error && <Alert>{error}</Alert>}
      {result && !busy && <Verdict v={result} />}
    </div>
  );

  return (
    <div className="verify">
      <div className="verify-intro">
        <h1>Проверка на сертификат</h1>
        {!id && <p>
          Сканирайте QR кода от сертификата, въведете неговия идентификатор или качете PDF файла.
          Системата изчислява SHA-256 отпечатъка на файла и го сравнява със записа в блокчейна.
        </p>}
      </div>

      {id && outcome}

      <div className="verify-inputs">
        <form className="verify-id" onSubmit={onSubmit}>
          <label htmlFor="cert-id" className="field-label">Идентификатор или линк от QR кода</label>
          <div className="inline">
            <input id="cert-id" value={code} onChange={(e) => setCode(e.target.value)} placeholder="напр. 7dedef97-66fe-437e-9fd4-60177578408c" autoComplete="off" spellCheck={false} />
            <button className="btn btn-primary" disabled={busy || !code.trim()}>Провери</button>
          </div>
        </form>

        <div
          className={`dropzone ${dragging ? "is-drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFile(e.dataTransfer.files[0]);
          }}
        >
          <p>
            <strong>{id ? "Сравнете файла с този сертификат." : "Проверете PDF файл."}</strong> Пуснете го тук или
          </p>
          <button type="button" className="btn btn-quiet" onClick={() => fileInput.current?.click()} disabled={busy}>Изберете файл</button>
          <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} />
          <span className="field-hint">Файлът не се записва на сървъра. Използва се само за изчисляване на хеша.</span>
        </div>
      </div>

      {!id && outcome}
    </div>
  );
}
