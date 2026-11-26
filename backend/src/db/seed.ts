/**
 * Демо данни: администратор, двама издатели (с акаунти в блокчейна) и притежател.
 * Пуска се след публикуване на договора: npm run seed
 */
import { migrate, pool, queryOne } from "./pool";
import { createIssuer, createUser } from "../services/users";
import { issueCertificate, revokeCertificate } from "../services/certificates";
import type { AuthUser } from "../middleware/auth";

async function main() {
  await migrate();
  await createUser("admin@certchain.local", "Admin123!", "Системен администратор", "ADMIN");
  const issuers = [
    { email: "issuer@tu-sofia.local", password: "Issuer123!", fullName: "доц. д-р Мария Петрова", organizationName: "Технически университет - София" },
    { email: "academy@softacademy.local", password: "Issuer123!", fullName: "Иван Димитров", organizationName: "Софтуерна академия" },
  ];
  for (const i of issuers) {
    const exists = await queryOne("SELECT 1 FROM users WHERE email = $1", [i.email]);
    if (!exists) {
      const r = await createIssuer(null, i);
      console.log(`Издател ${i.email}: ${r.walletAddress}`);
    }
  }
  await createUser("student@certchain.local", "Student123!", "Александър Николов", "HOLDER");
  if (process.env.SEED_SAMPLES !== "false") await seedSamples();
  console.log("Демо данните са създадени.");
}

/** Примерни сертификати, за да не е празна системата при демонстрация. */
async function seedSamples() {
  const any = await queryOne("SELECT 1 FROM certificates LIMIT 1");
  if (any) return;
  const asUser = async (email: string): Promise<AuthUser> => {
    const u = (await queryOne<{ id: string; email: string; role: any; full_name: string }>("SELECT id, email, role, full_name FROM users WHERE email = $1", [email]))!;
    return { id: u.id, email: u.email, role: u.role, name: u.full_name };
  };
  const tu = await asUser("issuer@tu-sofia.local");
  const academy = await asUser("academy@softacademy.local");
  const samples: [AuthUser, any][] = [
    [tu, { holderName: "Александър Николов", holderEmail: "student@certchain.local", title: "Диплома", program: "Компютърно и софтуерно инженерство", grade: "Отличен 5.75", description: "Образователно-квалификационна степен бакалавър", issueDate: "2026-07-15" }],
    [academy, { holderName: "Александър Николов", holderEmail: "student@certchain.local", title: "Сертификат", program: "Разработка на смарт договори със Solidity", grade: "96 / 100 точки", description: "Курс с продължителност 60 учебни часа", issueDate: "2026-03-20" }],
    [tu, { holderName: "Виктория Стоянова", holderEmail: "viktoria@example.com", title: "Удостоверение", program: "Летен стаж по информационна сигурност", description: "Положен изпит и защитен курсов проект", issueDate: "2026-08-29" }],
    [academy, { holderName: "Мартин Костов", holderEmail: "martin@example.com", title: "Сертификат", program: "React и TypeScript за напреднали", grade: "88 / 100 точки", issueDate: "2026-05-11" }],
    [academy, { holderName: "Елена Василева", holderEmail: "elena@example.com", title: "Сертификат", program: "Бази от данни с PostgreSQL", grade: "91 / 100 точки", issueDate: "2026-06-02" }],
  ];
  const ids: string[] = [];
  for (const [issuer, data] of samples) ids.push((await issueCertificate(issuer, data)).id);
  await revokeCertificate(academy, ids[3], "Установено нарушение на правилата при изпита");
  console.log(`Създадени примерни сертификати: ${ids.length} (един отнет)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
