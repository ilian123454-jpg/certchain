import type { Verification } from "../api";
import { formatDate, formatDateTime } from "../format";
import { Detail } from "./ui";

const TITLES: Record<Verification["result"], string> = {
  VALID: "Валиден сертификат",
  REVOKED: "Отнет сертификат",
  INVALID: "Невалиден документ",
  NOT_FOUND: "Сертификатът не е намерен",
};

function SealMark({ result }: { result: Verification["result"] }) {
  const glyph =
    result === "VALID" ? <path d="M38 61l14 14 28-30" /> :
    result === "REVOKED" ? <path d="M40 60h40" /> :
    result === "INVALID" ? <path d="M44 44l32 32M76 44L44 76" /> :
    <path d="M50 48a10 10 0 1 1 14 9c-3 2-4 4-4 7M60 76v1" />;
  return (
    <svg className="seal-mark" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="56" className="seal-ring" />
      <circle cx="60" cy="60" r="46" className="seal-dash" />
      <g className="seal-glyph">{glyph}</g>
    </svg>
  );
}

/** Сравнява двата хеша знак по знак: съвпадащите знаци са бледи, различните са подчертани. */
export function HashCompare({ document, chain }: { document: string; chain: string }) {
  const same = document.toLowerCase() === chain.toLowerCase();
  return (
    <div className={`hash-compare ${same ? "is-same" : "is-diff"}`}>
      <div className="hash-row">
        <span className="hash-label">Хеш на качения файл</span>
        <code>
          {document.split("").map((ch, i) => (
            <span key={i} className={ch.toLowerCase() === chain[i]?.toLowerCase() ? "eq" : "ne"}>{ch}</span>
          ))}
        </code>
      </div>
      <div className="hash-row">
        <span className="hash-label">Хеш, записан в блокчейна</span>
        <code>{chain}</code>
      </div>
      <p className="hash-note">{same ? "Всички 64 знака съвпадат." : `Различават се ${document.split("").filter((c, i) => c.toLowerCase() !== chain[i]?.toLowerCase()).length} от 64 знака.`}</p>
    </div>
  );
}

export function Verdict({ v }: { v: Verification }) {
  const c = v.certificate;
  const ch = v.chain;
  return (
    <section className={`verdict verdict-${v.result.toLowerCase()}`} aria-live="polite">
      <div className="verdict-head">
        <SealMark result={v.result} />
        <div>
          <h2>{TITLES[v.result]}</h2>
          <p>{v.message}</p>
          {c?.revokeReason && <p className="verdict-reason">Причина за отнемане: {c.revokeReason}</p>}
        </div>
      </div>

      {v.documentHash && ch && <HashCompare document={v.documentHash} chain={ch.documentHash} />}

      {(c || ch) && (
        <div className="verdict-grid">
          {c && (
            <dl className="details">
              <h3>Данни от сертификата</h3>
              <Detail label="Притежател">{c.holderName}</Detail>
              <Detail label="Документ">{c.title}</Detail>
              <Detail label="Програма">{c.program}</Detail>
              {c.grade && <Detail label="Оценка">{c.grade}</Detail>}
              <Detail label="Дата на издаване">{formatDate(c.issueDate)}</Detail>
              <Detail label="Рег. номер">{c.certificateNumber}</Detail>
            </dl>
          )}
          {ch && (
            <dl className="details">
              <h3>Запис в блокчейна</h3>
              <Detail label="Издател">{ch.issuerName}</Detail>
              <Detail label="Адрес на издателя" mono>{ch.issuer}</Detail>
              <Detail label="Регистриран на">{formatDateTime(ch.issuedAt)}</Detail>
              {ch.revokedAt && <Detail label="Отнет на">{formatDateTime(ch.revokedAt)}</Detail>}
              {c?.blockNumber != null && <Detail label="Блок">{c.blockNumber}</Detail>}
              {c?.txHash && <Detail label="Транзакция" mono>{c.txHash}</Detail>}
              <Detail label="Смарт договор" mono>{ch.contractAddress}</Detail>
            </dl>
          )}
        </div>
      )}
      <p className="verdict-time">Проверено на {formatDateTime(v.checkedAt)}</p>
    </section>
  );
}
