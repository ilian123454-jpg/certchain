import fs from "fs";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config";
import * as chain from "../src/services/blockchain";
import { app, login, resetDatabase, sampleCertificate, seedUsers } from "./helpers";
import { pool } from "../src/db/pool";

let adminToken: string;
let issuerToken: string;
let issuer2Token: string;
let holderToken: string;

beforeAll(async () => {
  await resetDatabase();
  await seedUsers();
  adminToken = await login("admin@test.local", "Admin123!");
  issuerToken = await login("issuer@test.local", "Issuer123!");
  issuer2Token = await login("issuer2@test.local", "Issuer123!");
  holderToken = await login("holder@test.local", "Holder123!");
});

async function issue(over: Record<string, unknown> = {}, token = issuerToken) {
  const res = await request(app).post("/api/certificates").set("Authorization", `Bearer ${token}`).send(sampleCertificate(over));
  return res;
}

async function downloadPdf(id: string, token = holderToken): Promise<Buffer> {
  const res = await request(app)
    .get(`/api/certificates/${id}/pdf`)
    .set("Authorization", `Bearer ${token}`)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  return res.body as Buffer;
}

describe("Автентикация и роли", () => {
  it("отказва грешна парола", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "issuer@test.local", password: "грешна" });
    expect(res.status).toBe(401);
  });

  it("регистрира притежател и не позволява дублиран имейл", async () => {
    const ok = await request(app).post("/api/auth/register").send({ email: "new@test.local", password: "Password1", fullName: "Нов Потребител" });
    expect(ok.status).toBe(201);
    expect(ok.body.user.role).toBe("HOLDER");
    const dup = await request(app).post("/api/auth/register").send({ email: "NEW@test.local", password: "Password1", fullName: "Нов Потребител" });
    expect(dup.status).toBe(409);
  });

  it("изисква токен за защитените адреси", async () => {
    expect((await request(app).get("/api/certificates")).status).toBe(401);
    expect((await request(app).get("/api/certificates").set("Authorization", "Bearer abc")).status).toBe(401);
  });

  it("притежател не може да издава сертификати", async () => {
    const res = await issue({}, holderToken);
    expect(res.status).toBe(403);
  });

  it("издател няма достъп до администраторския панел", async () => {
    const res = await request(app).get("/api/admin/stats").set("Authorization", `Bearer ${issuerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("Издаване и проверка", () => {
  let certId: string;
  let pdf: Buffer;

  it("валидира входните данни", async () => {
    const res = await issue({ holderEmail: "не-е-имейл", issueDate: "2999-01-01" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION");
  });

  it("издава сертификат: PDF, хеш и транзакция в блокчейна", async () => {
    const res = await issue();
    expect(res.status).toBe(201);
    const c = res.body.certificate;
    expect(c.status).toBe("ISSUED");
    expect(c.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(c.documentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(c.certificateNumber).toMatch(/^CC-2026-\d{6}$/);
    certId = c.id;

    const record = await chain.getRecord(c.chainId);
    expect(record.status).toBe("VALID");
    expect(record.documentHash).toBe(c.documentHash);
    expect(record.issuerName).toBe("Тестов университет");
  });

  it("притежателят вижда сертификата си и изтегля оригиналния PDF", async () => {
    const list = await request(app).get("/api/certificates").set("Authorization", `Bearer ${holderToken}`);
    expect(list.body.certificates.map((c: any) => c.id)).toContain(certId);
    pdf = await downloadPdf(certId);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("друг издател няма достъп до чужд сертификат", async () => {
    const res = await request(app).get(`/api/certificates/${certId}`).set("Authorization", `Bearer ${issuer2Token}`);
    expect(res.status).toBe(403);
  });

  it("проверка по идентификатор (QR) връща VALID без вход в системата", async () => {
    const res = await request(app).get(`/api/verify/${certId}`);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("VALID");
    expect(res.body.certificate.holderName).toBe("Иван Иванов");
    expect(res.body.certificate).not.toHaveProperty("holderEmail");
    expect(res.body.chain.issuerName).toBe("Тестов университет");
  });

  it("проверка на оригиналния файл връща VALID", async () => {
    const res = await request(app).post("/api/verify/file").attach("file", pdf, "cert.pdf");
    expect(res.body.result).toBe("VALID");
    expect(res.body.certificate.id).toBe(certId);
  });

  it("променен документ (един байт) е невалиден", async () => {
    const tampered = Buffer.from(pdf);
    tampered[Math.floor(tampered.length / 2)] ^= 0x01;
    const withId = await request(app).post("/api/verify/file").field("certificateId", certId).attach("file", tampered, "cert.pdf");
    expect(withId.body.result).toBe("INVALID");
    expect(withId.body.reason).toBe("HASH_MISMATCH");
    const withoutId = await request(app).post("/api/verify/file").attach("file", tampered, "cert.pdf");
    expect(withoutId.body.result).toBe("INVALID");
    expect(withoutId.body.reason).toBe("UNKNOWN_DOCUMENT");
  });

  it("отхвърля файл, който не е PDF", async () => {
    const res = await request(app).post("/api/verify/file").attach("file", Buffer.from("hello world"), "a.pdf");
    expect(res.status).toBe(400);
  });

  it("несъществуващ идентификатор връща NOT_FOUND", async () => {
    const a = await request(app).get("/api/verify/7c9e6679-7425-40de-944b-e07fc1f90ae7");
    expect(a.body.result).toBe("NOT_FOUND");
    const b = await request(app).get("/api/verify/не-е-uuid");
    expect(b.body.result).toBe("NOT_FOUND");
  });

  it("подмяна на хеша в базата се открива, защото източник на истината е блокчейнът", async () => {
    const other = await issue({ holderName: "Петър Петров" });
    const id = other.body.certificate.id;
    await pool.query("UPDATE certificates SET document_hash = $2 WHERE id = $1", [id, "0x" + "ab".repeat(32)]);
    const res = await request(app).get(`/api/verify/${id}`);
    expect(res.body.result).toBe("INVALID");
    expect(res.body.reason).toBe("INTEGRITY_ERROR");
  });
});

describe("Отнемане", () => {
  it("друг издател не може да отнеме сертификата", async () => {
    const c = (await issue()).body.certificate;
    const res = await request(app).post(`/api/certificates/${c.id}/revoke`).set("Authorization", `Bearer ${issuer2Token}`).send({ reason: "Опит за чуждо отнемане" });
    expect(res.status).toBe(403);
  });

  it("издателят отнема сертификат и проверката показва REVOKED дори за оригиналния файл", async () => {
    const c = (await issue()).body.certificate;
    const pdf = await downloadPdf(c.id, issuerToken);
    const res = await request(app).post(`/api/certificates/${c.id}/revoke`).set("Authorization", `Bearer ${issuerToken}`).send({ reason: "Грешно въведени данни" });
    expect(res.status).toBe(200);
    expect(res.body.certificate.status).toBe("REVOKED");
    const v1 = await request(app).get(`/api/verify/${c.id}`);
    expect(v1.body.result).toBe("REVOKED");
    expect(v1.body.certificate.revokeReason).toBe("Грешно въведени данни");
    const v2 = await request(app).post("/api/verify/file").attach("file", pdf, "c.pdf");
    expect(v2.body.result).toBe("REVOKED");
    const again = await request(app).post(`/api/certificates/${c.id}/revoke`).set("Authorization", `Bearer ${issuerToken}`).send({ reason: "Втори опит за отнемане" });
    expect(again.status).toBe(409);
  });

  it("администраторът може да отнеме всеки сертификат", async () => {
    const c = (await issue()).body.certificate;
    const res = await request(app).post(`/api/certificates/${c.id}/revoke`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Решение на администратора" });
    expect(res.status).toBe(200);
  });
});

describe("Неоторизиран издател и деактивиране", () => {
  it("адрес без роля ISSUER се отхвърля от смарт договора", async () => {
    const { Wallet, JsonRpcProvider, Contract, ethers } = await import("ethers");
    const d = JSON.parse(fs.readFileSync(config.deploymentFile, "utf8"));
    const provider = new JsonRpcProvider(config.rpcUrl);
    const funded = new Wallet("0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356", provider); // Hardhat акаунт #7
    const c = new Contract(d.address, d.abi, funded);
    await expect(c.issueCertificate(ethers.id("x"), ethers.sha256("0x01"))).rejects.toThrow();
  });

  it("деактивиран издател не може да издава, но старите му сертификати остават валидни", async () => {
    const c = (await issue({}, issuer2Token)).body.certificate;
    const issuers = await request(app).get("/api/admin/issuers").set("Authorization", `Bearer ${adminToken}`);
    const second = issuers.body.issuers.find((i: any) => i.email === "issuer2@test.local");
    const patch = await request(app).patch(`/api/admin/issuers/${second.id}`).set("Authorization", `Bearer ${adminToken}`).send({ isActive: false });
    expect(patch.status).toBe(200);
    const res = await issue({}, issuer2Token);
    expect(res.status).toBe(403);
    expect((await request(app).get(`/api/verify/${c.id}`)).body.result).toBe("VALID");
  });
});

describe("Недостъпна блокчейн мрежа", () => {
  it("не представя непотвърдена операция като успешна и позволява повторен опит", async () => {
    const original = config.rpcUrl;
    config.rpcUrl = "http://127.0.0.1:1";
    chain.__resetForTests();
    const res = await issue();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("BLOCKCHAIN_UNAVAILABLE");
    const failed = res.body.error.details.certificate;
    expect(failed.status).toBe("FAILED");

    // Притежателят не вижда неуспешния сертификат.
    const list = await request(app).get("/api/certificates").set("Authorization", `Bearer ${holderToken}`);
    expect(list.body.certificates.map((c: any) => c.id)).not.toContain(failed.id);

    const health = await request(app).get("/api/health");
    expect(health.status).toBe(503);

    config.rpcUrl = original;
    chain.__resetForTests();
    const retry = await request(app).post(`/api/certificates/${failed.id}/retry`).set("Authorization", `Bearer ${issuerToken}`);
    expect(retry.status).toBe(200);
    expect(retry.body.certificate.status).toBe("ISSUED");
    expect((await request(app).get(`/api/verify/${failed.id}`)).body.result).toBe("VALID");
  });
});

describe("Администрация", () => {
  it("създава нов издател с акаунт в блокчейна", async () => {
    const res = await request(app)
      .post("/api/admin/issuers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "third@test.local", password: "Issuer123!", fullName: "Трети Издател", organizationName: "Трета организация" });
    expect(res.status).toBe(201);
    expect(await chain.getRecord(chain.certificateChainId("няма"))).toMatchObject({ status: "NONE" });
    const token = await login("third@test.local", "Issuer123!");
    expect((await issue({}, token)).status).toBe(201);
  });

  it("връща статистика и журнал", async () => {
    const stats = await request(app).get("/api/admin/stats").set("Authorization", `Bearer ${adminToken}`);
    expect(stats.status).toBe(200);
    expect(stats.body.blockchain.available).toBe(true);
    expect(stats.body.blockchain.totals.issued).toBeGreaterThan(0);
    expect(stats.body.database.revoked).toBeGreaterThanOrEqual(2);
    const auditRes = await request(app).get("/api/admin/audit").set("Authorization", `Bearer ${adminToken}`);
    expect(auditRes.body.entries.length).toBeGreaterThan(0);
  });

  it("журналът на проверките не съдържа IP адреси в чист вид", async () => {
    const rows = await pool.query("SELECT client_hash FROM verification_logs WHERE client_hash IS NOT NULL LIMIT 5");
    for (const r of rows.rows) expect(r.client_hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
