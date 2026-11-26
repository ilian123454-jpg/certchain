import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isBytes32Hex, sha256Hex } from "../src/services/crypto";
import { renderCertificatePdf } from "../src/services/pdf";

const pdfData = {
  certificateNumber: "CC-2026-000001",
  verifyUrl: "http://localhost:3000/verify/abc",
  holderName: "Мария Димитрова",
  title: "Сертификат",
  program: "Уеб технологии",
  issueDate: "2026-06-01",
  organizationName: "Тест",
  signerName: "Издател",
  createdAt: new Date("2026-06-01T10:00:00Z"),
};

describe("SHA-256", () => {
  it("дава известния отпечатък за 'abc' (NIST тестов вектор)", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("резултатът е във формат bytes32", () => {
    expect(isBytes32Hex(sha256Hex(Buffer.from("x")))).toBe(true);
  });
  it("промяна на един байт променя хеша напълно", () => {
    const a = Buffer.from("сертификат-1");
    const b = Buffer.from(a);
    b[0] ^= 1;
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });
});

describe("Криптиране на частни ключове (AES-256-GCM)", () => {
  it("криптира и декриптира", () => {
    const key = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const enc = encryptSecret(key);
    expect(enc).not.toContain(key.slice(2));
    expect(decryptSecret(enc)).toBe(key);
  });
  it("два криптирания на един и същ ключ се различават (случаен IV)", () => {
    expect(encryptSecret("a")).not.toBe(encryptSecret("a"));
  });
  it("открива подправен шифротекст", () => {
    const parts = encryptSecret("secret").split(".");
    const tampered = Buffer.from(parts[2], "base64");
    tampered[0] ^= 1;
    expect(() => decryptSecret([parts[0], parts[1], tampered.toString("base64")].join("."))).toThrow();
  });
});

describe("PDF генериране", () => {
  it("създава валиден PDF", async () => {
    const pdf = await renderCertificatePdf(pdfData);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10000);
  });
  it("при еднакви данни и време генерирането е детерминистично", async () => {
    const a = await renderCertificatePdf(pdfData);
    const b = await renderCertificatePdf(pdfData);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });
  it("същото видимо съдържание, генерирано в друг момент, има различен хеш, затова се пази оригиналният файл", async () => {
    const a = await renderCertificatePdf(pdfData);
    const b = await renderCertificatePdf({ ...pdfData, createdAt: new Date("2026-06-01T10:00:01Z") });
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });
});
