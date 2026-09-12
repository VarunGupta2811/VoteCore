# 🗳️ VoteCore

> **Enterprise-Grade Platform-as-a-Service (PaaS) Voting Architecture**

VoteCore is a full-stack, multi-tenant digital voting platform built to run secure, phase-locked elections. It combines a Python/Flask backend with an Oracle Database to deliver strict role-based access control, cryptographic identity verification, and an immutable audit trail — so election integrity isn't just a policy, it's enforced at the database level.

---

## ✨ Features

- **Multi-Tenant PaaS Model** — Anyone can request a new organization (student council, corporate board, etc.). On Super Admin approval, VoteCore dynamically provisions an isolated environment and promotes the requester to `ORGANIZER`.
- **Role-Based Access Control (RBAC)**
  - **Super Admin** — global oversight, organization approval, fraud monitoring.
  - **Organizer** — election creation, phase management, candidate scrutiny.
  - **Voter** — secure ballot casting and real-time result tracking.
- **State-Machine Election Lifecycle** — elections move through strict phases (`UPCOMING → NOMINATION → ACTIVE → COMPLETED`); out-of-phase actions like early ballots or late registrations are rejected at the database level.
- **Immutable Audit & Fraud Logging** — Oracle PL/SQL triggers watch every transaction and write tamper-proof records of anomalies (double-voting, phase-bypass attempts, unauthorized access) to a dedicated `FRAUD_LOGS` ledger.
- **"Civic Ledger" UI** — a mobile-first design system using deep ink tones, guilloché seal watermarks, and subtle micro-animations to evoke the weight of a physical government document.

---

## 🛠️ Tech Stack

| Layer                    | Technology                |
|---------------------------|----------------------------|
| Frontend                  | HTML, CSS, JavaScript     |
| Backend                   | Python, Flask             |
| Database                  | Oracle Database           |
| Database interface        | Oracle SQL*Plus           |
| Python → Oracle           | `oracledb` driver         |
| Authentication            | Flask Sessions + bcrypt + OTP |
| API                       | Flask REST API            |
| API Testing               | Postman                   |
| Version Control           | Git / GitHub              |

---

## 🔒 Security

VoteCore follows a zero-trust approach to authentication and data access:

1. **Password cryptography** — all passwords are hashed with `bcrypt` before storage.
2. **Session verification** — protected routes require OTP verification, binding a validated identity to a secure, server-side Flask session.
3. **Environment isolation** — DB credentials and API keys live in a `.env` file, excluded from version control via `.gitignore`.

---

## 📁 Project Structure

```
VoteCore/
├── backend/                # Flask app, REST API routes, DB access & PL/SQL logic
│   ├── [APP_ENTRY_FILE]        # e.g. app.py — Flask app entry point
│   ├── [ROUTES_DIR]            # API route blueprints (auth, elections, admin, etc.)
│   ├── [MODELS_DIR]            # DB models / query layer
│   ├── [SQL_SCRIPTS_DIR]       # Schema + PL/SQL trigger definitions
│   └── requirements.txt        # Python dependencies
├── frontend/                # Client-facing HTML/CSS/JS
│   ├── [TEMPLATES_DIR]
│   └── [STATIC_DIR]
├── .vscode/                 # Editor configuration
├── .gitignore
└── README.md
```
> Replace the bracketed paths above with your actual file/folder names — GitHub's directory listing wasn't fully browsable from this end, so these are placeholders for the real structure inside `backend/` and `frontend/`.

---

## 🚀 Getting Started

### Prerequisites

- Python **[PYTHON_VERSION]**
- Oracle Database **[ORACLE_VERSION]** (Oracle XE works for local development)
- Oracle Instant Client (required by `oracledb` if running in thick mode)
- `pip` and `virtualenv`
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
```

### 4. Set up the database

Run the schema and PL/SQL trigger scripts against your Oracle instance:

```bash
sqlplus [DB_USER]/[DB_PASSWORD]@[DB_DSN] @[SCHEMA_SCRIPT].sql
```

### 5. Run the app

```bash
python [APP_ENTRY_FILE]
```

The app will be available at `http://localhost:[PORT]`.

---

## ▶️ Usage

1. Register an account and sign in.
2. Request a new organization to become an **Organizer** (subject to Super Admin approval).
3. As an **Organizer**: create an election, add candidates, and move it through its phases.
4. As a **Voter**: cast your ballot during the `ACTIVE` phase and watch results update in real time.
5. As a **Super Admin**: approve pending organizations and review the fraud/audit log.

A Postman collection for exercising the REST API is available at **[POSTMAN_COLLECTION_LINK]**.

---

## 🤝 Contributing

Contributions are welcome:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m "Add your feature"`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

Please open an issue first for major changes so we can discuss the approach.

---

## 📄 License

This project doesn't currently specify a license. Add a `LICENSE` file (e.g. MIT) if you want others to be able to reuse or contribute to the code — until then, all rights are reserved by default.

---

## 📬 Contact

**Varun Gupta** — [varun.vip2811@gmail.com](mailto:varun.vip2811@gmail.com)