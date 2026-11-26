import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import path from "path";
import { config } from "../config";

export interface CertificatePdfData {
  certificateNumber: string;
  verifyUrl: string;
  holderName: string;
  title: string;
  program: string;
  description?: string | null;
  grade?: string | null;
  issueDate: string; // YYYY-MM-DD
  organizationName: string;
  signerName: string;
  createdAt: Date;
}

const NAVY = "#14284b";
const GOLD = "#b08d3c";
const GRAY = "#555555";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y} г.`;
}

/**
 * Генерира окончателния PDF сертификат (A4, хоризонтално) с QR код към страницата за проверка.
 * Връща точните байтове на файла. Хешът се изчислява върху тях, а файлът се пази без промяна,
 * защото дори повторно генериран документ със същото съдържание би имал различни байтове.
 */
export async function renderCertificatePdf(data: CertificatePdfData): Promise<Buffer> {
  const qrPng = await QRCode.toBuffer(data.verifyUrl, { errorCorrectionLevel: "M", margin: 1, width: 360, color: { dark: NAVY } });

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 0,
    info: {
      Title: `${data.title} ${data.certificateNumber}`,
      Author: data.organizationName,
      Subject: "Цифров сертификат, регистриран в блокчейн",
      Creator: "CertChain",
      Producer: "CertChain",
      CreationDate: data.createdAt,
    },
  });

  const f = (name: string) => path.join(config.fontsDir, name);
  doc.registerFont("serif", f("LiberationSerif-Regular.ttf"));
  doc.registerFont("serif-bold", f("LiberationSerif-Bold.ttf"));
  doc.registerFont("serif-italic", f("LiberationSerif-Italic.ttf"));
  doc.registerFont("sans", f("DejaVuSans.ttf"));
  doc.registerFont("sans-bold", f("DejaVuSans-Bold.ttf"));
  doc.registerFont("mono", f("DejaVuSansMono.ttf"));

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const W = doc.page.width; // 841.89
  const H = doc.page.height; // 595.28

  // Фон и рамки
  doc.rect(0, 0, W, H).fill("#fbfaf6");
  doc.lineWidth(3).strokeColor(NAVY).rect(22, 22, W - 44, H - 44).stroke();
  doc.lineWidth(0.8).strokeColor(GOLD).rect(30, 30, W - 60, H - 60).stroke();

  // Горна лента с организацията
  doc.fillColor(NAVY).font("sans-bold").fontSize(11).text(data.organizationName.toUpperCase(), 0, 58, { width: W, align: "center", characterSpacing: 1.5 });
  doc.moveTo(W / 2 - 40, 80).lineTo(W / 2 + 40, 80).lineWidth(1).strokeColor(GOLD).stroke();

  doc.fillColor(NAVY).font("serif-bold").fontSize(40).text(data.title.toUpperCase(), 60, 100, { width: W - 120, align: "center", characterSpacing: 2 });

  doc.fillColor(GRAY).font("serif-italic").fontSize(15).text("С настоящото се удостоверява, че", 0, doc.y + 14, { width: W, align: "center" });

  doc.fillColor("#111111").font("serif-bold").fontSize(32).text(data.holderName, 60, doc.y + 12, { width: W - 120, align: "center" });
  const nameBottom = doc.y + 4;
  doc.moveTo(W / 2 - 170, nameBottom).lineTo(W / 2 + 170, nameBottom).lineWidth(0.6).strokeColor(GOLD).stroke();

  doc.fillColor(GRAY).font("serif-italic").fontSize(15).text("успешно завърши", 0, nameBottom + 14, { width: W, align: "center" });
  doc.fillColor(NAVY).font("serif-bold").fontSize(20).text(data.program, 80, doc.y + 6, { width: W - 160, align: "center" });

  if (data.grade) {
    doc.fillColor("#222222").font("serif").fontSize(14).text(`Оценка: ${data.grade}`, 0, doc.y + 8, { width: W, align: "center" });
  }
  if (data.description) {
    doc.fillColor(GRAY).font("serif").fontSize(11.5).text(data.description, 150, doc.y + 8, { width: W - 300, align: "center", lineGap: 1 });
  }

  // Долна част: дата, подпис, QR
  const baseY = H - 168;
  doc.fillColor("#222222").font("serif").fontSize(12);
  doc.text(`Дата на издаване: ${formatDate(data.issueDate)}`, 70, baseY + 30, { width: 240 });
  doc.text(`Рег. № ${data.certificateNumber}`, 70, baseY + 48, { width: 240 });

  doc.moveTo(W / 2 - 110, baseY + 44).lineTo(W / 2 + 110, baseY + 44).lineWidth(0.6).strokeColor("#333333").stroke();
  doc.font("serif-bold").fontSize(12).text(data.signerName, W / 2 - 150, baseY + 50, { width: 300, align: "center" });
  doc.font("serif").fontSize(10.5).fillColor(GRAY).text("оторизиран издател", W / 2 - 150, baseY + 66, { width: 300, align: "center" });

  const qrSize = 92;
  const qrX = W - 70 - qrSize;
  const qrY = baseY - 4;
  doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  doc.font("sans").fontSize(7).fillColor(GRAY).text("Сканирайте за проверка", qrX - 20, qrY + qrSize + 3, { width: qrSize + 40, align: "center" });

  doc.font("sans").fontSize(7.5).fillColor("#777777").text(
    "Автентичността и целостта на този документ могат да бъдат проверени чрез QR кода. SHA-256 отпечатъкът на файла е регистриран в блокчейн. Всяка промяна на файла води до неуспешна проверка.",
    150,
    H - 64,
    { width: W - 300, align: "center", lineGap: 1 },
  );
  doc.font("mono").fontSize(6.5).fillColor("#999999").text(data.verifyUrl, 150, H - 42, { width: W - 300, align: "center" });

  doc.end();
  return done;
}
