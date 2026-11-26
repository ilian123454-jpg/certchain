import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const sha = (s: string) => ethers.sha256(ethers.toUtf8Bytes(s));
const certId = (s: string) => ethers.id(s);

enum Status { None, Valid, Revoked }
enum Result { NotFound, Valid, HashMismatch, Revoked }

describe("CertificateRegistry", () => {
  async function deployFixture() {
    const [admin, issuer, otherIssuer, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CertificateRegistry");
    const registry = await Registry.deploy(admin.address);
    await registry.addIssuer(issuer.address, "Технически университет - София");
    await registry.addIssuer(otherIssuer.address, "Друга организация");
    return { registry, admin, issuer, otherIssuer, stranger };
  }

  describe("Управление на издатели", () => {
    it("администраторът добавя издател и записва името му", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      expect(await registry.isIssuer(issuer.address)).to.equal(true);
      expect(await registry.issuerNames(issuer.address)).to.equal("Технически университет - София");
    });

    it("неоторизиран адрес не може да добавя издатели", async () => {
      const { registry, stranger } = await loadFixture(deployFixture);
      await expect(registry.connect(stranger).addIssuer(stranger.address, "X"))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("нулев адрес не може да бъде издател", async () => {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.addIssuer(ethers.ZeroAddress, "X")).to.be.revertedWithCustomError(registry, "InvalidIssuer");
    });

    it("премахнат издател не може да издава, но старите му сертификати остават валидни", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      await registry.connect(issuer).issueCertificate(certId("a"), sha("doc-a"));
      await expect(registry.removeIssuer(issuer.address)).to.emit(registry, "IssuerRemoved").withArgs(issuer.address);
      await expect(registry.connect(issuer).issueCertificate(certId("b"), sha("doc-b")))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      expect(await registry.verifyCertificate(certId("a"), sha("doc-a"))).to.equal(Result.Valid);
    });
  });

  describe("Издаване", () => {
    it("записва хеш, издател, време и статус и излъчва събитие", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      const tx = registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-1"));
      await expect(tx).to.emit(registry, "CertificateIssued");
      const ts = await time.latest();
      const c = await registry.getCertificate(certId("c1"));
      expect(c.documentHash).to.equal(sha("pdf-1"));
      expect(c.issuer).to.equal(issuer.address);
      expect(c.issuedAt).to.equal(ts);
      expect(c.revokedAt).to.equal(0);
      expect(c.status).to.equal(Status.Valid);
      expect(await registry.totalIssued()).to.equal(1n);
      expect(await registry.findByHash(sha("pdf-1"))).to.equal(certId("c1"));
    });

    it("отхвърля издаване от неоторизиран адрес", async () => {
      const { registry, stranger } = await loadFixture(deployFixture);
      await expect(registry.connect(stranger).issueCertificate(certId("c1"), sha("pdf-1")))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("отхвърля повторно издаване със същия идентификатор", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      await registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-1"));
      await expect(registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-2")))
        .to.be.revertedWithCustomError(registry, "CertificateAlreadyExists");
    });

    it("отхвърля регистриране на същия документ под друг идентификатор", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      await registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-1"));
      await expect(registry.connect(issuer).issueCertificate(certId("c2"), sha("pdf-1")))
        .to.be.revertedWithCustomError(registry, "HashAlreadyRegistered");
    });

    it("отхвърля нулев хеш и нулев идентификатор", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      await expect(registry.connect(issuer).issueCertificate(certId("c1"), ethers.ZeroHash))
        .to.be.revertedWithCustomError(registry, "InvalidHash");
      await expect(registry.connect(issuer).issueCertificate(ethers.ZeroHash, sha("x")))
        .to.be.revertedWithCustomError(registry, "InvalidCertificateId");
    });
  });

  describe("Проверка", () => {
    it("връща Valid при съвпадащ хеш", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      await registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-1"));
      expect(await registry.verifyCertificate(certId("c1"), sha("pdf-1"))).to.equal(Result.Valid);
    });

    it("връща HashMismatch за променен документ", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      await registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-1"));
      expect(await registry.verifyCertificate(certId("c1"), sha("pdf-1 променен"))).to.equal(Result.HashMismatch);
    });

    it("връща NotFound за несъществуващ идентификатор", async () => {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.verifyCertificate(certId("няма"), sha("x"))).to.equal(Result.NotFound);
    });
  });

  describe("Отнемане", () => {
    it("издателят отнема свой сертификат, а проверката връща Revoked дори при съвпадащ хеш", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      await registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-1"));
      await expect(registry.connect(issuer).revokeCertificate(certId("c1"), "Грешка в данните"))
        .to.emit(registry, "CertificateRevoked");
      expect(await registry.verifyCertificate(certId("c1"), sha("pdf-1"))).to.equal(Result.Revoked);
      const c = await registry.getCertificate(certId("c1"));
      expect(c.status).to.equal(Status.Revoked);
      expect(c.revokedAt).to.be.greaterThan(0);
      expect(c.documentHash).to.equal(sha("pdf-1"));
      expect(await registry.totalRevoked()).to.equal(1n);
    });

    it("друг издател не може да отнеме чужд сертификат", async () => {
      const { registry, issuer, otherIssuer } = await loadFixture(deployFixture);
      await registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-1"));
      await expect(registry.connect(otherIssuer).revokeCertificate(certId("c1"), "x"))
        .to.be.revertedWithCustomError(registry, "NotAllowedToRevoke");
    });

    it("администраторът може да отнеме всеки сертификат", async () => {
      const { registry, admin, issuer } = await loadFixture(deployFixture);
      await registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-1"));
      await expect(registry.connect(admin).revokeCertificate(certId("c1"), "Решение на администратора")).to.emit(registry, "CertificateRevoked");
    });

    it("премахнат издател вече не може да отнема", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      await registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-1"));
      await registry.removeIssuer(issuer.address);
      await expect(registry.connect(issuer).revokeCertificate(certId("c1"), "x"))
        .to.be.revertedWithCustomError(registry, "NotAllowedToRevoke");
    });

    it("не позволява двойно отнемане и отнемане на несъществуващ сертификат", async () => {
      const { registry, issuer } = await loadFixture(deployFixture);
      await registry.connect(issuer).issueCertificate(certId("c1"), sha("pdf-1"));
      await registry.connect(issuer).revokeCertificate(certId("c1"), "x");
      await expect(registry.connect(issuer).revokeCertificate(certId("c1"), "x"))
        .to.be.revertedWithCustomError(registry, "CertificateAlreadyRevoked");
      await expect(registry.connect(issuer).revokeCertificate(certId("nope"), "x"))
        .to.be.revertedWithCustomError(registry, "CertificateNotFound");
    });
  });
});
