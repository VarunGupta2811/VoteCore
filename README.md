# 🗳️ VoteCore V2

> **Enterprise-Grade Platform-as-a-Service (PaaS) Voting Architecture**

VoteCore V2 is a full-stack, multi-tenant digital voting platform built to run secure, phase-locked elections. It combines a Python/Flask backend with an Oracle Database to deliver strict role-based access control, cryptographic ballot secrecy, and an immutable audit trail — ensuring election integrity is enforced directly at the database level.

---

## 📖 Project Overview

VoteCore V2 lets organizations run elections as a managed, multi-tenant service rather than a one-off script. A **Super Admin** creates and owns each election, appoints an **Election Organizer** to run its day-to-day logistics, and the platform enforces a strict, one-way lifecycle (`UPCOMING → NOMINATION → ACTIVE → COMPLETED → ARCHIVED`) so no phase can be skipped or reopened once it closes. Ballots are cryptographically decoupled from voter identity, every sensitive transaction is written to an immutable fraud log, and completed elections can be exported as PDF audit reports.

---

## ✨ Core Features

- **Multi-Tenant PaaS Model** — Organizations apply to host an election; on Super Admin approval, VoteCore provisions an isolated environment for that election.
- **Five-Tier Role-Based Access Control (RBAC)** — see [RBAC Details](#-rbac-details) below for the full breakdown, including the corrected election-creation rule.
- **State-Machine Election Lifecycle** — elections move through strict, one-way phases (`UPCOMING → NOMINATION → ACTIVE → COMPLETED → ARCHIVED`); out-of-phase actions (early ballots, late registrations) are rejected by the backend.
- **Cryptographic Ballot Secrecy** — voter identity is permanently decoupled from the ballot record. A `VOTER_POST_STATUS` ledger tracks *that* a whitelisted voter has voted, while the `VOTE` record itself remains fully anonymous.
- **Immutable Audit & Fraud Logging** — every transaction is monitored, and anomalies (double-voting attempts, unauthorized access, phase-bypass attempts) are permanently written to a tamper-proof `FRAUD_LOGS` ledger.
- **PDF Audit Reports** — audit and fraud logs can be exported as PDF reports via `ReportLab`.
- **"Civic Ledger" UI** — a mobile-first design system using deep navy and gold tones, optimized contrast, and dedicated fraud-log readability to evoke the weight of a physical government document.

---

## 🛠️ Tech Stack

| Layer                  | Technology                                        |
|-------------------------|----------------------------------------------------|
| Frontend                | HTML, CSS, Vanilla JavaScript                      |
| Backend                 | Python **[PYTHON_VERSION]**, Flask                 |
| Database                | Oracle Database 21c XE                             |
| DB Driver               | `oracledb`                                         |
| Authentication          | Flask Sessions, `bcrypt`, OTP email verification   |
| Document Generation     | `ReportLab` (PDF audit logs)                       |

---

## 🔒 Security Architecture

VoteCore V2 follows a zero-trust approach to authentication and data access:

1. **Password & PII Cryptography** — passwords and sensitive government IDs (Aadhaar/Voter ID) are hashed with `bcrypt` before storage.
2. **Session Verification** — protected routes require email OTP verification, which binds the validated identity to a secure, server-side Flask session with active login throttling.
3. **CSRF Protection** — cryptographic tokens are issued post-login and automatically attached to all authenticated, state-changing requests.
4. **Environment Isolation** — DB credentials and SMTP API keys live in a local `.env` file, excluded from version control.

---

## 🧑‍⚖️ RBAC Details

> **Correction from a previous revision:** Election Organizers do **not** create elections. Only the **Super Admin** can create an election; the Organizer's role is limited to managing/organizing an election that already exists.

| Role | Creates Elections? | Responsibilities |
|------|---------------------|-------------------|
| **Super Admin** | ✅ Yes | Creates elections, appoints Election Organizers, exercises global oversight, monitors fraud, and archives completed elections. |
| **Election Organizer** | ❌ No — manages existing elections only | Phase management, ballot position definitions, party/ticket scrutiny, and voter roll approval on an election created by a Super Admin. Bound by a strict neutrality rule: cannot contest or vote. |
| **Party Leader** | No | Forms a political party, manages its members, and delegates tickets/manifestos to candidates. |
| **Candidate** | No | An approved participant contesting a specific ballot position. |
| **Voter** | No | A whitelisted participant who casts a single, anonymous ballot. |

---

## 📁 Project Structure

```text
VoteCore/
├── backend/
│   ├── app.py                  # Main Flask application and REST API routes
│   ├── db.py                   # Oracle database connection pool management
│   ├── requirements.txt        # Python dependency tracking
│   └── .env                    # Environment variables (ignored in Git)
├── frontend/
│   ├── index.html              # Landing and authentication UI
│   ├── dashboard.html          # Voter & Party Leader portal
│   ├── admin.html              # Super Admin & Organizer portal
│   ├── election.html           # Dynamic ballot and nomination interface
│   ├── script.js               # Frontend API consumption and DOM logic
│   └── style.css                # Civic Ledger design system
├── database/
│   └── schema.sql              # Master Oracle schema (tables, constraints, FKs)
├── start-server.bat            # Windows runtime launcher
└── README.md
```

---

## 🚀 Installation

### Prerequisites

- Python **[PYTHON_VERSION]**
- Oracle Database 21c XE (or access to an Oracle instance)
- Oracle Instant Client (required by `oracledb` if running in thick mode)
- `pip` and `virtualenv`
- An SMTP account for sending OTP emails
- Git

### 1. Clone the repository

```bash
git clone https://github.com/VarunGupta2811/VoteCore.git
cd VoteCore
```

### 2. Set up the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure environment variables

Create a `.env` file inside `backend/`:

```env
DB_USER=[YOUR_DB_USER]
DB_PASSWORD=[YOUR_DB_PASSWORD]
DB_DSN=[YOUR_ORACLE_DSN]
SECRET_KEY=[FLASK_SECRET_KEY]
SMTP_HOST=[YOUR_SMTP_HOST]
SMTP_USER=[YOUR_SMTP_USER]
SMTP_PASSWORD=[YOUR_SMTP_PASSWORD]
```

### 4. Set up the database

Run the master schema against your Oracle instance:

```bash
sqlplus [DB_USER]/[DB_PASSWORD]@[DB_DSN] @database/schema.sql
```

### 5. Run the app

**Windows** — double-click or run:

```bash
start-server.bat
```

**macOS/Linux** — run the Flask app directly:

```bash
cd backend
python app.py
```

The app will be available at `http://localhost:[PORT]`.

---

## ▶️ Usage

1. **Super Admin** signs in, creates a new election, and appoints an Election Organizer to run it.
2. **Election Organizer** defines ballot positions, manages the election's phases, and approves the voter roll — but cannot create elections, contest, or vote.
3. **Party Leaders** form parties and delegate tickets/manifestos to **Candidates**, who get scrutinized and approved for specific ballot positions.
4. **Voters** cast a single anonymous ballot once the election reaches the `ACTIVE` phase, and can follow results as they're tallied.
5. **Super Admin** monitors the `FRAUD_LOGS` ledger throughout, and archives the election once it's `COMPLETED` — audit and fraud reports can be exported as PDF via `ReportLab`.

---

## 🤝 Contributing

Contributions are welcome:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m "Add your feature"`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

Please open an issue first for major changes so the approach can be discussed before you invest time in it.

---

## 📄 License

This project doesn't currently specify a license. Add a `LICENSE` file (e.g. MIT) if you want others to be able to reuse or contribute to the code — until then, all rights are reserved by default.

---

## 📬 Contact

**Varun Gupta** — [varun.vip2811@gmail.com](mailto:varun.vip2811@gmail.com)