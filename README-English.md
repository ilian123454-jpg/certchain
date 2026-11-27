# Blockchain-Based Digital Certificate Issuance and Verification System

Prototype developed as part of a Bachelor's thesis at the Technical University of Sofia, Faculty of Telecommunications and Computer Systems (FTCS).

**In a nutshell:** A university (or course provider) issues a certificate as a PDF containing a QR code. The file's fingerprint (SHA-256 hash) is recorded on the blockchain. Anyone who receives the certificate can scan the QR code or upload the PDF file and see within seconds whether the document is authentic, has been modified, or has been revoked.

---

## Table of Contents

1. [How It Works](#1-how-it-works)
2. [Running with Docker (Easiest)](#2-running-with-docker-easiest)
3. [Running without Docker](#3-running-without-docker)
4. [Demo Accounts and Demonstration Flow](#4-demo-accounts-and-demonstration-flow)
5. [Project Structure](#5-project-structure)
6. [Tests](#6-tests)
7. [Troubleshooting](#7-troubleshooting)
8. [Configuration (Environment Variables)](#8-configuration-environment-variables)
9. [REST API](#9-rest-api)
10. [Security and Limitations](#10-security-and-limitations)

---

## 1. How It Works

### The Four Roles

| Role | Responsibilities |
|---|---|
| **Issuer** (university, course provider) | Issues certificates, views certificates it has issued, and revokes certificates with a reason |
| **Holder** (student) | Views their certificates, downloads the original PDF, and copies the verification link |
| **Verifier** (employer) | **No account required.** Scans the QR code or uploads the PDF file to view the result |
| **Administrator** | Approves organizations that are allowed to issue certificates, views statistics and the audit log |

### What Happens When a Certificate Is Issued

```text
The issuer fills in the form
        |
        v
1. The server generates a PDF certificate with a QR code.
   The QR code points to http://localhost:3000/verify/<identifier>
        |
        v
2. The server calculates the SHA-256 hash of the exact PDF file bytes
   (64 hexadecimal characters, e.g. 0x18585fae97b9...79ae1).
   Changing even a single byte in the file produces a completely different hash.
        |
        v
3. The certificate is saved in PostgreSQL with PENDING status,
   and the PDF file is stored in backend/storage/certificates/.
        |
        v
4. A transaction is sent to the smart contract:
   issueCertificate(identifier, hash)
   The transaction is signed using the issuer's blockchain key.
        |
        +-- success --> status ISSUED (the transaction hash and block number are stored)
        |
        +-- error ----> status FAILED (the certificate is NOT shown to the student;
                         the issuer can click "Retry")
```

### What Is Stored on the Blockchain and What Is Not

| On the blockchain (public and immutable) | In the database only (access-controlled) |
|---|---|
| Certificate identifier | Student's name and email |
| SHA-256 hash of the PDF file | Programme, grade, text |
| Issuer's address and organization name | The PDF file itself (stored in a server folder) |
| Issuance and revocation timestamps | Passwords (bcrypt), roles |
| Status: valid or revoked | Issuers' private keys (encrypted) |

**No personal data is stored on the blockchain.** The document's contents cannot be reconstructed from its hash.

### What Happens During Verification

There are two verification methods:

**A) By QR code or identifier.** The server reads the record from the smart contract and compares it with the database.

**B) By uploading the PDF file.** The server calculates the SHA-256 hash of the uploaded file and asks the smart contract whether a certificate with that hash exists. The file is not stored anywhere; it is used only to calculate the hash.

The result is always one of the following four statuses:

| Result | Condition |
|---|---|
| ✅ **Valid** | The record exists, the hash matches, and the certificate has not been revoked |
| ❌ **Invalid** | The file has been modified (the hash does not match), or no such document exists |
| 🟧 **Revoked** | The document is the original, but the issuer has revoked it |
| ❔ **Not Found** | No certificate exists with the given identifier |

**Important for security:** the **blockchain, not the database, is the source of truth**. If someone accesses the database and changes a certificate's hash, verification will return "Invalid" because the database record will no longer match the blockchain record.

### Why Each Issuer Has Its Own Blockchain Account

When the administrator creates an issuer, the system generates a new key pair and grants the corresponding address the "issuer" role in the smart contract. This makes it possible to identify **exactly which organization** issued a certificate on the blockchain. The contract also rejects issuance attempts from addresses without this role, even if someone bypasses the server.

### Architecture

```text
   Browser (React)
        |
        | HTTP /api
        v
   nginx -----------------> Backend API (Node.js + Express)
                                  |             |
                                  | SQL         | JSON-RPC (ethers.js)
                                  v             v
                             PostgreSQL     Blockchain (Hardhat, Ethereum-compatible)
                             users,         └─ CertificateRegistry.sol smart contract
                             metadata,
                             logs
                                  |
                             backend/storage/certificates/*.pdf
                             (original files)
```

| Component | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Server | Node.js 20, Express, TypeScript |
| Database | PostgreSQL 16 |
| Smart contract | Solidity 0.8.24, OpenZeppelin AccessControl |
| Blockchain | Local Hardhat network (Ethereum-compatible) |
| Blockchain integration | ethers.js v6 |
| PDF and QR code | PDFKit, qrcode |
| Tests | Hardhat (contract), Vitest + Supertest (server) |
| Deployment | Docker Compose, nginx |

---

## 2. Running with Docker (Easiest)

### One-Time Setup

1. Install **Docker Desktop**: https://www.docker.com/products/docker-desktop/
2. Start Docker Desktop and wait until its status indicator shows that it is running (green).

### Starting the Application

**Option 1:** Double-click **`start.bat`** in this folder. It will open the browser automatically.

**Option 2:** Open a terminal (PowerShell or cmd) in the `certchain` folder and run:

```bash
docker compose up --build
```

The first launch takes a few minutes because Docker downloads and builds everything. Subsequent launches are faster.

When the logs display `CertChain API listening on http://localhost:4000`, open:

### http://localhost:3000

### Stopping the Application

```bash
docker compose down
```

### What Docker Does at Startup

| Service | Purpose |
|---|---|
| `blockchain` | Starts a local blockchain (Hardhat) on port 8545 |
| `deployer` | Deploys the smart contract to the local blockchain, then stops |
| `postgres` | Starts the database |
| `backend` | Creates the database tables, loads demo data, and starts the API on port 4000 |
| `frontend` | Serves the website on port 3000 (nginx) |

> **Note:** The local blockchain stores data in memory. Therefore, everything starts from scratch (with the demo data) each time it is launched. This is expected behavior for a demonstration.

---

## 3. Running without Docker

You need **Node.js 20+** (https://nodejs.org) and **PostgreSQL 14+** (https://www.postgresql.org/download/windows/).

You will need three separate terminals.

### Step 1: Database (One-Time Setup)

Run the following commands in a terminal (use the password you set when installing PostgreSQL):

```bash
psql -U postgres -c "CREATE USER certchain WITH PASSWORD 'certchain'"
psql -U postgres -c "CREATE DATABASE certchain OWNER certchain"
```

> If `psql` is not recognized, use the full path, for example:
> `"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres ...`
> Alternatively, perform the same steps through pgAdmin.

### Step 2: Blockchain (Terminal 1 — Keep It Running)

```bash
cd contracts
npm install --legacy-peer-deps
npx hardhat node
```

### Step 3: Smart Contract and Server (Terminal 2)

```bash
cd contracts
npm run deploy:local

cd ../backend
npm install
npm run seed
npm run dev
```

`npm run seed` creates the demo users and five sample certificates (one of which is revoked).

The server starts at http://localhost:4000.

### Step 4: Website (Terminal 3)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**.

### If You Restart the Blockchain (Terminal 1)

The blockchain starts with an empty state, so the database must also be reset:

```bash
psql -U postgres -c "DROP DATABASE certchain"
psql -U postgres -c "CREATE DATABASE certchain OWNER certchain"
cd contracts && npm run deploy:local
cd ../backend && npm run seed && npm run dev
```

---

## 4. Demo Accounts and Demonstration Flow

| Role | Email | Password |
|---|---|---|
| Issuer (Technical University of Sofia) | issuer@tu-sofia.local | Issuer123! |
| Issuer (Software Academy) | academy@softacademy.local | Issuer123! |
| Holder | student@certchain.local | Student123! |
| Administrator | admin@certchain.local | Admin123! |

The login screen includes buttons that automatically fill in the demo credentials with one click.

### Suggested Demonstration Flow (Approximately 5 Minutes)

1. **Issue a certificate.** Log in as the issuer (Technical University of Sofia) → "New Certificate" → fill in the form → "Issue and Record on Blockchain".
2. **Show the proof.** On the certificate page, show the SHA-256 hash, transaction, block number, and QR code. Click "Download PDF".
3. **Verify using the QR code.** Log out (or use another browser) → open the verification link. The result should be **Valid**.
4. **Verify using the file.** Upload the downloaded PDF. The two hashes should match across all 64 characters.
5. **Tamper with the document.** Open the PDF in another application and save it again (or modify something), then upload it again. The result should be **Invalid Document**, with the differing hash characters highlighted in red.
6. **Revoke the certificate.** Log in as the issuer → open the certificate → click "Revoke Certificate" and provide a reason. A new verification should show **Revoked**, even for the original file.
7. **Administrator view.** Log in as the administrator → show statistics, issuers and their blockchain addresses, and the audit log.

> **Tip:** The QR code points to `localhost`, so scanning it with a phone works only if the phone can access the computer. For the demonstration, it is easier to open the link in the computer's browser (using the "Open Verification" or "Copy Verification Link" button).

---

## 5. Project Structure

```text
certchain/
├── docker-compose.yml        all Docker services
├── start.bat                 launch with a double-click (Windows)
├── README.md                 this file
│
├── contracts/                SMART CONTRACT
│   ├── contracts/CertificateRegistry.sol   the contract itself
│   ├── test/CertificateRegistry.test.ts    17 contract tests
│   ├── scripts/deploy.ts                   deploys the contract and saves its address in deployments/
│   └── hardhat.config.ts                   configuration (compiler, networks)
│
├── backend/                  SERVER (REST API)
│   ├── src/
│   │   ├── index.ts                  starts the server
│   │   ├── app.ts                    registers all routes
│   │   ├── config.ts                 central configuration
│   │   ├── routes/
│   │   │   ├── auth.ts               login and registration
│   │   │   ├── certificates.ts       issuance, list, PDF, QR code, revocation
│   │   │   ├── verify.ts             public verification (by ID and by file)
│   │   │   └── admin.ts              issuers, statistics, audit log
│   │   ├── services/
│   │   │   ├── certificates.ts       certificate issuance and verification logic
│   │   │   ├── blockchain.ts         smart contract integration (ethers.js)
│   │   │   ├── pdf.ts                PDF certificate generation with QR code
│   │   │   ├── crypto.ts             SHA-256 and key encryption
│   │   │   └── users.ts              issuer creation (with a blockchain account)
│   │   ├── middleware/               token and role validation, error handling
│   │   └── db/
│   │       ├── schema.sql            database tables
│   │       └── seed.ts               demo data
│   ├── tests/                        33 tests (unit and integration)
│   └── assets/fonts/                 fonts with Cyrillic support
│
└── frontend/                 WEBSITE
    └── src/
        ├── pages/
        │   ├── VerifyPage.tsx        public verification
        │   ├── LoginPage.tsx, RegisterPage.tsx
        │   ├── IssuerPage.tsx        issuer dashboard/list
        │   ├── IssueFormPage.tsx     certificate issuance form
        │   ├── CertificatePage.tsx   certificate page (QR, PDF, revocation)
        │   ├── HolderPage.tsx        student's certificates
        │   └── AdminPage.tsx         administrator dashboard
        ├── components/Verdict.tsx    verification result and hash comparison
        └── api.ts                    all API requests
```

### Database Tables

| Table | Contents |
|---|---|
| `users` | Users with the ADMIN, ISSUER, or HOLDER role. Issuers also have a blockchain address and an encrypted key |
| `certificates` | Certificate data, PDF path, hash, status (PENDING, ISSUED, FAILED, REVOKED), and transaction |
| `verification_logs` | Each verification attempt: method, result, and time. The IP address is stored only as an irreversible fingerprint |
| `audit_log` | Every action: login, issuance, revocation, and new issuer creation |

### Smart Contract Functions

| Function | Who Can Call It | Purpose |
|---|---|---|
| `addIssuer(address, name)` | Administrator | Grants permission to issue certificates |
| `removeIssuer(address)` | Administrator | Revokes issuance permission; previously issued certificates remain valid |
| `issueCertificate(id, hash)` | Issuer | Records a certificate; rejects duplicate IDs or duplicate documents |
| `revokeCertificate(id, reason)` | Certificate issuer or administrator | Marks a certificate as revoked; its history remains on the blockchain |
| `verifyCertificate(id, hash)` | Anyone, free of charge | Returns Valid, HashMismatch, Revoked, or NotFound |
| `getCertificate(id)` | Anyone, free of charge | Returns the hash, issuer, timestamps, and status |
| `findByHash(hash)` | Anyone, free of charge | Finds a certificate using only the file |

Gas costs: issuance ≈ 138,600; revocation ≈ 58,000; verification is free (read-only).

---

## 6. Tests

### Smart Contract (17 Tests)

```bash
cd contracts
npx hardhat test
npm run gas          # runs the same tests and displays a gas usage table
```

### Server (33 Tests)

The integration tests run against a **real database and a real blockchain**, so the following setup is required:

```bash
# One-time setup: create the test database
psql -U postgres -c "CREATE DATABASE certchain_test OWNER certchain"

# In a separate terminal: start the blockchain
cd contracts && npx hardhat node

# Run the tests
cd backend && npm test
```

All scenarios from the specification are covered: original and modified documents, non-existent identifiers, revoked certificates, unauthorized issuers, duplicate issuance, an unavailable blockchain network and retry, and hash tampering in the database.

---

## 7. Troubleshooting

| Problem | Solution |
|---|---|
| `docker` is not recognized / `Cannot connect to the Docker daemon` | Start Docker Desktop and wait until its status indicator turns green |
| `port is already allocated` (3000, 4000, or 8545) | Another process is using the port. Stop it, or stop the old containers with `docker compose down` |
| The website opens but displays "Server is not responding" | The server may still be starting. Wait 20–30 seconds and refresh the page |
| "Smart contract has not been deployed" | Without Docker: run `npm run deploy:local` in `contracts` (the blockchain must be running) |
| All verifications return "Invalid" or "Not registered" after a restart | The blockchain was restarted while the database still contains old data. See "If You Restart the Blockchain" in Section 3 |
| "Blockchain network is unavailable" during issuance | `npx hardhat node` is not running. Start it, then click "Retry" on the certificate |
| `npm install` in `contracts` returns an `ERESOLVE` error | Use `npm install --legacy-peer-deps` |
| `password authentication failed for user "certchain"` | Create the user as described in Section 3, Step 1, or change `DATABASE_URL` in `backend/.env` |
| PowerShell: `running scripts is disabled` | Use cmd instead of PowerShell, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| A downloaded PDF becomes "Invalid" after being opened and saved again | This is expected: the application changed the file's bytes. Verify the original file or use the QR code |
| Many verification requests in a short period return error 429 | Rate limiting is enabled to prevent overload: 60 verifications per minute. Wait one minute or increase `VERIFY_RATE_LIMIT` |

---

## 8. Configuration (Environment Variables)

Without Docker: copy `backend/.env.example` to `backend/.env` and edit it if necessary.

All variables have default values for local development, so changes are usually not required.

| Variable | Default | Description |
|---|---|---|
| `PORT` | 4000 | Server port |
| `DATABASE_URL` | postgres://certchain:certchain@127.0.0.1:5432/certchain | Database connection string |
| `RPC_URL` | http://127.0.0.1:8545 | Blockchain node address |
| `DEPLOYMENT_FILE` | ../contracts/deployments/localhost.json | File containing the contract address |
| `ADMIN_PRIVATE_KEY` | Hardhat account #0 | Contract administrator key (publicly known; for development only) |
| `JWT_SECRET` | demo value | Secret used to sign sessions. **Change before real-world use** |
| `KEY_ENCRYPTION_SECRET` | demo value | Secret used to encrypt issuers' keys. **Change before real-world use** |
| `PUBLIC_APP_URL` | http://localhost:3000 | URL embedded in the QR code |
| `VERIFY_RATE_LIMIT` | 60 | Maximum verifications per minute from a single address |
| `ISSUER_FUNDING_ETH` | 1.0 | ETH allocated to a new issuer for transaction fees (local network only) |

### Public Test Network (Optional)

For Sepolia, set `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` (an account holding test ETH), then run:

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

Then configure the server's `RPC_URL`, `DEPLOYMENT_FILE`, and `ADMIN_PRIVATE_KEY` for that network, and set `ISSUER_FUNDING_ETH=0` (issuers must be funded manually).

---

## 9. REST API

| Method and Endpoint | Access | Description |
|---|---|---|
| `POST /api/auth/login` | All users | Login; returns a JWT |
| `POST /api/auth/register` | All users | Holder registration |
| `GET /api/auth/me` | Authenticated | Current user |
| `GET /api/certificates` | Authenticated | Role-based certificate list; use `?q=` to search |
| `POST /api/certificates` | Issuer | Issue a certificate |
| `GET /api/certificates/:id` | Owner | Certificate details |
| `GET /api/certificates/:id/pdf` | Owner | Original PDF |
| `GET /api/certificates/:id/qr` | Owner | QR code (PNG) |
| `POST /api/certificates/:id/revoke` | Issuer, administrator | Revoke a certificate with a reason |
| `POST /api/certificates/:id/retry` | Issuer | Retry recording after a failed transaction |
| `GET /api/verify/:id` | Public | Verify by identifier |
| `POST /api/verify/file` | Public | Verify a PDF file (multipart; field: `file`) |
| `GET /api/admin/stats` | Administrator | Statistics from the database and smart contract |
| `GET/POST/PATCH /api/admin/issuers` | Administrator | Manage issuers |
| `GET /api/admin/audit` | Administrator | Audit log |
| `GET /api/health` | Public | Database and blockchain node status |

---

## 10. Security and Limitations

### Security Measures

- Two levels of access control: API-level authorization (JWT roles) and smart contract authorization (OpenZeppelin AccessControl).
- Passwords are hashed using bcrypt. Issuers' private keys are encrypted with AES-256-GCM, and the encryption key is stored in an environment variable rather than in the database.
- All input data is validated (Zod). File size is limited, and uploaded files are checked to ensure they are PDFs.
- Public verification responses do not expose the holder's email address; IP addresses are not stored.
- Verification trusts the blockchain, not the database.

### Prototype Limitations (Also Described in the Bachelor's Thesis)

- Issuers' keys are stored on the server. In a production system, each issuer would sign transactions independently (using a hardware wallet or HSM).
- File-based verification requires the exact original file. If the PDF is saved again using another application, its bytes change and file verification fails; QR-code verification continues to work.
- The administrator determines which blockchain address belongs to each organization.
- The demonstration uses a local blockchain, which is reset whenever it is restarted.
