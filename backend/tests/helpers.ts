import request from "supertest";
import { createApp } from "../src/app";
import { migrate, pool } from "../src/db/pool";
import { createIssuer, createUser } from "../src/services/users";

export const app = createApp();

export async function resetDatabase() {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
}

export async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

export async function seedUsers() {
  await createUser("admin@test.local", "Admin123!", "Админ", "ADMIN");
  await createIssuer(null, { email: "issuer@test.local", password: "Issuer123!", fullName: "Издател Едно", organizationName: "Тестов университет" });
  await createIssuer(null, { email: "issuer2@test.local", password: "Issuer123!", fullName: "Издател Две", organizationName: "Друга организация" });
  await createUser("holder@test.local", "Holder123!", "Иван Иванов", "HOLDER");
}

export const sampleCertificate = (over: Record<string, unknown> = {}) => ({
  holderName: "Иван Иванов",
  holderEmail: "holder@test.local",
  title: "Сертификат",
  program: "Блокчейн технологии и смарт договори",
  grade: "Отличен 6.00",
  issueDate: "2026-06-30",
  ...over,
});
