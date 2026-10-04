<div align="center">

# 🗳️ VoteCore V2

**A multi-tenant, phase-gated online voting platform with database-level election integrity**

![Python](https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-3.1-000000?logo=flask&logoColor=white)
![Oracle](https://img.shields.io/badge/Oracle_DB-21c_XE-F80000?logo=oracle&logoColor=white)
![JavaScript](https://img.shields.io/badge/Frontend-Vanilla_JS-F7DF1E?logo=javascript&logoColor=black)
![ReportLab](https://img.shields.io/badge/PDF-ReportLab-2D6CDF)
![License](https://img.shields.io/badge/License-[LICENSE_TYPE]-lightgrey)

[Overview](#-project-overview) •
[Features](#-core-features) •
[Architecture](#-architecture) •
[Installation](#-installation) •
[API](#-api-reference) •
[Security](#-security-architecture) •
[Contributing](#-contributing)

</div>

---

## 📖 Project Overview

VoteCore V2 lets organizations run elections as a managed, multi-tenant service. An institution applies to host an election; a **Super Admin** approves the request, which provisions the election and appoints the requester as its **Election Organizer**. The organizer then runs the election day to day: defining ballot positions, scrutinizing parties and candidate tickets, whitelisting voters, and moving the election through its phases.

Integrity rules are enforced both in the Flask API and in Oracle itself (foreign keys, `CHECK` constraints, composite primary keys and triggers). Ballots are stored without any voter identifier, so a vote cannot be traced back to the person who cast it, while a separate ledger records *that* a voter has voted.

<!-- Add screenshots once available -->
<!-- ![Dashboard](docs/screenshots/[DASHBOARD_SCREENSHOT].png) -->

---

## ✨ Core Features

### 🏛️ Platform and tenancy
- **Hosting request workflow** — any registered user can apply to host an election for their institution. Super Admin approval creates the host jurisdiction and election and appoints the applicant as organizer, recording the appointment in the audit log.
- **Phase-gated actions** — the backend only allows each action in the right phase: parties can be formed or joined during `NOMINATION`, ballots are accepted only while `ACTIVE`, and results are released only when `COMPLETED`.

### 🔐 Identity and access
- **Email OTP registration** — new accounts are confirmed with a one-time code before anything is written to the database.
- **Two-step login** — password check followed by an emailed OTP, with attempt limits.
- **Role-based access control** — Super Admin, Election Organizer, Party Leader, Candidate and Voter (see [RBAC Details](#-rbac-details)).
- **Neutrality enforcement** — database triggers stop an election's organizer from being a candidate, party leader or party member in the same election.

### 🎫 Nominations and campaigns
- **Party registration per election**, with the founder automatically nominated for President.
- **Party membership and ticket assignment** — leaders assign members to ballot positions with a manifesto.
- **Organizer scrutiny** — parties and candidate tickets only reach the ballot after organizer approval.
- **Independent candidates** supported (`ELECTION_PARTY_ID` is nullable).

### 🗳️ Voting
- **One vote per voter per position**, enforced by an atomic status update on `VOTER_POST_STATUS` (`ELIGIBLE` → `VOTED`).
- **Anonymous ballots** — the `VOTE` table holds election, position and candidate only.
- **Voter roll whitelisting** — voters apply per election and the organizer approves them.

### 📜 Accountability
- **Audit log** (`AUDIT_LOGS`) — administrative actions are written by the API and by database triggers on user and election changes.
- **Fraud log** (`FRAUD_LOGS`) — double-vote attempts (`DOUBLE_VOTE_ATTEMPT`) and ballots from unapproved voters (`UNAUTHORIZED_BALLOT`) are recorded. The API exposes no route that edits or deletes audit or fraud records.
- **PDF security ledger** — the Super Admin can export a per-election fraud/security report generated with ReportLab.

### 🎨 Interface
- **"Civic Ledger" design system** — dark indigo surfaces with lilac "ballot paper" cards, teal for verified/active states and crimson for fraud alerts. Fraunces for headings, IBM Plex Sans for body text and IBM Plex Mono for ledger-style data. Mobile-first layout using Flexbox and Grid.

---

## 🏗️ Architecture

```mermaid
flowchart LR
    subgraph Client["Frontend (static files)"]
        UI["HTML · CSS · Vanilla JS"]
    end
    subgraph Server["Backend"]
        API["Flask REST API<br/>app.py"]
        MAIL["SMTP<br/>OTP email"]
        PDF["ReportLab<br/>PDF export"]
    end
    DB[("Oracle Database<br/>tables · view · triggers")]

    UI -- "fetch + session cookie<br/>+ X-CSRF-Token" --> API
    API -- "python-oracledb<br/>bind variables" --> DB
    API --> MAIL
    API --> PDF
```

The frontend is a set of static pages that call the API at the `API_URL` defined in `script.js`. The Flask app serves JSON and PDFs only; it does not serve the HTML files.

### Election lifecycle

```mermaid
stateDiagram-v2
    [*] --> UPCOMING: Hosting request approved
    UPCOMING --> NOMINATION: Organizer opens nominations
    NOMINATION --> ACTIVE: Organizer opens voting
    ACTIVE --> COMPLETED: Organizer closes voting
    COMPLETED --> ARCHIVED: Super Admin archives
    ARCHIVED --> [*]
```

| Phase | What is allowed |
|---|---|
| `UPCOMING` | Organizer defines ballot positions; voters can apply to the roll |
| `NOMINATION` | Parties are registered and joined; tickets are assigned and scrutinized |
| `ACTIVE` | Whitelisted voters cast ballots |
| `COMPLETED` | Results are published |
| `ARCHIVED` | Election is hidden from public lists |

### Login flow

```mermaid
sequenceDiagram
    actor U as User
    participant F as Frontend
    participant A as Flask API
    participant D as Oracle DB
    participant M as SMTP

    U->>F: Email + password
    F->>A: POST /api/auth/login
    A->>D: Load user, verify bcrypt hash
    A->>D: Store hashed OTP (OTP_VERIFICATION)
    A->>M: Email OTP
    A-->>F: OTP required
    U->>F: Enter OTP
    F->>A: POST /api/auth/verify-otp
    A->>D: Verify OTP, insert USER_SESSIONS row
    A-->>F: Session cookie + csrf_token
    F->>A: Later requests (cookie + X-CSRF-Token)
    A->>D: Confirm session is active and unexpired
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, Vanilla JavaScript |
| Backend | Python **3.14.7**, Flask 3.1, Flask-CORS |
| Database | Oracle Database 21c XE |
| DB driver | `python-oracledb` |
| Authentication | Flask sessions, `bcrypt`, email OTP over SMTP |
| Document generation | ReportLab (PDF audit ledger) |
| Configuration | `python-dotenv` |
| Tooling | `start-server.bat` (Windows launcher), `test_db.py`, `test_palette.ps1` |

Exact dependency versions are pinned in [`requirements.txt`](backend/requirements.txt).

---

## 🔒 Security Architecture

| Control | Implementation |
|---|---|
| **Password and ID hashing** | Passwords, voter ID (EPIC) and government ID numbers are hashed with `bcrypt` before storage. |
| **Password policy** | Minimum 8 characters with upper-case, lower-case, digit and special character. |
| **Two-factor login** | Emailed 6-digit OTP, stored as a bcrypt hash; limited to 5 attempts. |
| **Login throttling** | 5 failed attempts per 15-minute window. |
| **Server-validated sessions** | Every protected request is checked against `USER_SESSIONS` (active and unexpired, 24-hour lifetime). Logging out, or "log out all devices", deactivates the rows. |
| **CSRF protection** | A per-session token is issued at login and required in the `X-CSRF-Token` header for every `POST`, `PUT`, `PATCH` and `DELETE`. |
| **Cookie hardening** | Session cookie is `HttpOnly` and `SameSite=Lax`. |
| **SQL injection** | All queries use Oracle bind variables. |
| **Input validation** | Length-limited, trimmed text fields on all write endpoints. |
| **CORS allowlist** | Only `127.0.0.1` / `localhost` on ports `5500` and `5501` by default. |
| **Ballot secrecy** | `VOTE` has no voter column; participation is tracked separately in `VOTER_POST_STATUS`. |
| **Double-vote prevention** | Atomic `UPDATE ... WHERE STATUS = 'ELIGIBLE'`; failed attempts are written to `FRAUD_LOGS`. |
| **Organizer neutrality** | Triggers `TRG_CAND_NEUTRALITY`, `TRG_EPARTY_NEUTRALITY` and `TRG_EPM_NEUTRALITY`. |
| **Secret management** | Credentials live in a local `.env` file excluded from version control. |

> **Note on secrecy:** anonymity comes from keeping ballots and participation records in separate tables with no shared key. It is not encryption. Anyone with direct database access can still compare timestamps, so database access should be tightly restricted.

---

## 🧑‍⚖️ RBAC Details

| Role | How it is assigned | Responsibilities |
|---|---|---|
| **Super Admin** | Identified by an email check in `app.py` (see [Configuration](#-configuration)) | Approves hosting requests (which provisions elections and appoints organizers), archives completed elections, views global audit and fraud logs, exports PDF ledgers. Cannot vote or participate. |
| **Election Organizer** | Becomes `ELECTION.ORGANIZER_PID` when a hosting request is approved | Manages phases, defines ballot positions, approves voters, parties and tickets for their own election. Cannot be a candidate, party leader or member, and cannot vote in it. |
| **Party Leader** | Registers a party for an election | Manages party members and assigns candidate tickets and manifestos. |
| **Candidate** | Assigned a ticket by a leader and approved by the organizer | Contests a specific ballot position. |
| **Voter** | Any registered user approved onto an election's voter roll | Casts one anonymous ballot per position. |

---

## 📁 Project Structure

```text
VoteCore/
├── backend/
│   ├── app.py                  # Flask application and all REST API routes
│   ├── db.py                   # Oracle connection helper (used by test_db.py)
│   ├── test_db.py              # Oracle connectivity check
│   ├── requirements.txt        # Pinned Python dependencies
│   ├── _env.example            # Environment variable template
│   ├── .env                    # Your local configuration (git-ignored)
│   └── start-server.bat        # Windows launcher (expects ./venv next to app.py)
├── frontend/
│   ├── index.html              # Login, OTP and registration
│   ├── dashboard.html          # Election list and hosting requests
│   ├── election.html           # Ballot, parties, voter registration
│   ├── results.html            # Election results
│   ├── profile.html            # Profile and session management
│   ├── admin.html              # Super Admin and Organizer panels
│   ├── script.js               # API client and page logic
│   ├── style.css               # Civic Ledger design system
│   └── test_palette.ps1        # Style/markup contract check
├── database/
│   └── schema.sql              # Tables, indexes, result view, triggers
└── README.md
```

---

## 🚀 Installation

### Prerequisites

- Python **3.14.7**
- Oracle Database 21c XE, or access to another Oracle instance
- An SQL client that can run PL/SQL scripts (SQL*Plus, SQLcl or SQL Developer)
- An SMTP account for OTP emails (Gmail with an [App Password](https://support.google.com/accounts/answer/185833) works)
- Git

> `python-oracledb` runs in thin mode by default, so Oracle Instant Client is not required unless you opt in to thick mode in your own code.

### 1. Clone the repository

```bash
git clone https://github.com/VarunGupta2811/VoteCore.git
cd VoteCore
```

### 2. Set up the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Create the database schema

Run the schema as the Oracle user that will own the tables. It contains triggers terminated with `/`, so use a client that understands PL/SQL scripts:

```bash
sqlplus [DB_USER]/[DB_PASSWORD]@[DB_DSN] @../database/schema.sql
```

### 4. Configure environment variables

Create `backend/.env` from the template (see [Configuration](#-configuration) for every variable):

```bash
cp _env.example .env            # Windows: copy _env.example .env
```

### 5. Verify the database connection

```bash
python test_db.py
```

You should see `Oracle connection successful!` followed by the connected user.

### 6. Start the API

```bash
python app.py
```

On Windows you can use `start-server.bat` instead. The API listens on `http://127.0.0.1:5000`.

### 7. Serve the frontend

In a second terminal, serve the `frontend/` folder from an origin the backend allows (`127.0.0.1` or `localhost`, port `5500` or `5501`):

```bash
cd frontend
python -m http.server 5500
```

Open **http://127.0.0.1:5500/index.html**. The VS Code Live Server extension works equally well.

---

## ⚙️ Configuration

### Environment variables (`backend/.env`)

| Variable | Required | Description |
|---|:---:|---|
| `DB_USER` | ✅ | Oracle username |
| `DB_PASSWORD` | ✅ | Oracle password |
| `DB_DSN` | ✅ | Oracle connect string / DSN |
| `FLASK_SECRET_KEY` | ✅ | Session signing key. The app refuses to start without it. |
| `SMTP_EMAIL` | ✅ | Sender address for OTP emails |
| `SMTP_PASSWORD` | ✅ | SMTP password (Gmail: a Google App Password, not your account password) |
| `SMTP_SERVER` | ➖ | Defaults to `smtp.gmail.com` |
| `SMTP_PORT` | ➖ | Defaults to `587` |
| `SMTP_TIMEOUT` | ➖ | Present in the template |
| `VOTECORE_PORT` | ➖ | API port, defaults to `5000` |
| `FLASK_DEBUG` | ➖ | Set to `1` to enable debug mode (development only) |

Generate a secret key:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Make sure secrets never reach version control:

```gitignore
.env
venv/
__pycache__/
```

### Code-level settings

| Setting | Where | Notes |
|---|---|---|
| Super Admin identity | `app.py`, `is_super_admin` check in the `verify_otp` handler | Currently a hard-coded email comparison. Change it to your own admin account before deploying. |
| API base URL | `script.js`, `API_URL` | Defaults to `http://127.0.0.1:5000` |
| Allowed origins | `app.py`, `CORS(...)` | Add your frontend origin when deploying |

---

## ▶️ Usage

### End-to-end walkthrough

1. **Register and sign in** on `index.html`. Registration and every login each require an emailed OTP.
2. **Request hosting** — from the dashboard, a user submits an organization name, election title and description.
3. **Approve (Super Admin)** — in `admin.html`, review the application. Approval provisions the election in `UPCOMING` and makes the applicant its organizer.
4. **Configure (Organizer)** — add ballot positions (for example President, Secretary), then move the election to `NOMINATION`.
5. **Nominate** — participants register parties, members join, and party leaders assign candidate tickets. The organizer approves parties and tickets in the scrutiny panel.
6. **Whitelist voters** — voters apply from `election.html`; the organizer approves them.
7. **Vote** — the organizer moves the election to `ACTIVE`. Approved voters cast one ballot per position.
8. **Publish results** — the organizer moves the election to `COMPLETED`; standings appear on `results.html`.
9. **Audit and archive** — the Super Admin reviews audit and fraud logs, exports the PDF ledger and archives the election.

### Calling the API directly

Protected routes need the session cookie. State-changing requests also need the CSRF token returned by `verify-otp` (or `GET /api/auth/me`).

```bash
# 1. Password step (an OTP is emailed)
curl -c cookies.txt -X POST http://127.0.0.1:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "[EMAIL]", "password": "[PASSWORD]"}'

# 2. OTP step: the response includes "csrf_token"
curl -b cookies.txt -c cookies.txt -X POST http://127.0.0.1:5000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"otp": "[OTP_CODE]"}'

# 3. Read elections
curl -b cookies.txt http://127.0.0.1:5000/api/elections

# 4. Cast a vote
curl -b cookies.txt -X POST http://127.0.0.1:5000/api/elections/[ELECTION_ID]/vote \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: [CSRF_TOKEN]" \
  -d '{"candidate_id": [CANDIDATE_ID]}'
```

---

## 🔌 API Reference

Base URL: `http://127.0.0.1:5000`. All `/api/*` routes except the first four below require an authenticated session.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Validate registration data and email an OTP |
| `POST` | `/api/auth/register-verify` | Confirm the OTP and create the account |
| `POST` | `/api/auth/login` | Verify password and email a login OTP |
| `POST` | `/api/auth/verify-otp` | Verify the OTP and start a session |
| `GET` | `/api/auth/me` | Session state, role flags and CSRF token |
| `GET` | `/api/auth/profile` | Profile and affiliations |
| `POST` | `/api/auth/logout` | End the current session |
| `POST` | `/api/auth/logout-all` | End all active sessions |

### Elections and participation

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/elections` | List elections |
| `GET` | `/api/elections/<id>` | Election details and the caller's voter status |
| `POST` | `/api/elections/request-hosting` | Submit a hosting request (`org_name`, `title`, `description`) |
| `POST` | `/api/elections/<id>/register-voter` | Apply to the voter roll |
| `GET` | `/api/elections/<id>/positions` | Ballot positions |
| `GET` | `/api/elections/<id>/parties` | Approved parties |
| `POST` | `/api/elections/<id>/register-party` | Register a party (`party_name`, `manifesto`) |
| `POST` | `/api/elections/<id>/parties/<party_id>/join` | Join a party |
| `GET` | `/api/elections/<id>/my-party-members` | Members of the caller's party |
| `POST` | `/api/elections/<id>/assign-candidate` | Leader assigns a ticket (`member_pid`, `position`, `manifesto`) |
| `GET` | `/api/elections/<id>/candidates` | Approved candidates |
| `POST` | `/api/elections/<id>/vote` | Cast a vote (`candidate_id`) |
| `GET` | `/api/elections/<id>/results` | Results, only when `COMPLETED` |

### Administration

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/admin/host-requests` | Super Admin | List hosting applications |
| `POST` | `/api/admin/host-requests/<req_id>/approve` | Super Admin | Approve and provision |
| `POST` | `/api/admin/elections` | Super Admin | Create an election directly (`orgid`, `title`, `description`) |
| `DELETE` | `/api/admin/elections/<id>` | Super Admin | Archive an election |
| `GET` | `/api/admin/elections/<id>/export-fraud-log` | Super Admin | Download the PDF ledger |
| `GET` | `/api/admin/my-elections` | Organizer | Elections the caller organizes |
| `PUT` | `/api/admin/elections/<id>/status` | Organizer | Change phase (`status`) |
| `POST` | `/api/admin/elections/<id>/positions` | Organizer | Add a ballot position (`title`) |
| `GET` | `/api/admin/elections/<id>/pending-voters` | Organizer | Pending voter applications |
| `POST` | `/api/admin/elections/<id>/approve-voter` | Organizer | Approve a voter (`pid`) |
| `GET` | `/api/admin/elections/<id>/pending-parties` | Organizer | Pending parties |
| `POST` | `/api/admin/parties/<party_id>/approve` | Organizer | Approve a party |
| `GET` | `/api/admin/elections/<id>/pending-candidates` | Organizer | Pending tickets |
| `POST` | `/api/admin/candidates/<candidate_id>/approve` | Organizer | Approve a ticket |
| `GET` | `/api/admin/audit-logs` | Super Admin / Organizer | Global logs for the admin, own logs for an organizer |
| `GET` | `/api/admin/fraud-logs` | Super Admin / Organizer | Fraud alerts |

---

## 🗄️ Database Schema

`database/schema.sql` creates 18 tables, 8 indexes, one view and five triggers.

| Module | Tables |
|---|---|
| **Authentication and identity** | `UACCOUNT`, `GOV_IDENTITY`, `IDENTITY_WALLET`, `OTP_VERIFICATION`, `USER_SESSIONS` |
| **Platform provisioning** | `ELECTION_HOST_REQUEST`, `HOST_JURISDICTION`, `POLITICAL_PARTY` |
| **Core election** | `ELECTION`, `ELECTION_POSITION`, `EVENT_PARTICIPANTS` |
| **Nominations** | `ELECTION_PARTY`, `ELECTION_PARTY_MEMBER`, `CANDIDATE` |
| **Voting engine** | `VOTER_POST_STATUS`, `VOTE` |
| **Auditability** | `AUDIT_LOGS`, `FRAUD_LOGS` |

**View:** `V_ELECTION_RESULT_BY_POST` aggregates vote counts per candidate and position, labelling candidates without a party as `Independent`.

**Triggers:** three neutrality triggers (organizer cannot be a candidate, party leader or party member in their own election) and two audit triggers on `UACCOUNT` and `ELECTION`.

### How ballot secrecy is modelled

```mermaid
erDiagram
    UACCOUNT ||--o{ VOTER_POST_STATUS : "participation record"
    ELECTION_POSITION ||--o{ VOTER_POST_STATUS : "per position"
    ELECTION_POSITION ||--o{ VOTE : "per position"
    CANDIDATE ||--o{ VOTE : "receives"

    VOTER_POST_STATUS {
        number ELECTION_ID PK
        number POSITION_ID PK
        number PID PK
        string STATUS "ELIGIBLE or VOTED"
    }
    VOTE {
        number VOTE_ID PK
        number ELECTION_ID
        number POSITION_ID
        number CANDIDATE_ID
    }
```

`VOTER_POST_STATUS` knows who voted for which position. `VOTE` knows which candidate received a ballot. Nothing links the two.

---

## 🧪 Testing

There is no automated API test suite yet. Two checks are included:

```bash
# Oracle connectivity (from backend/)
python test_db.py
```

```powershell
# Style and markup contract (from frontend/, Windows PowerShell)
.\test_palette.ps1
```

`test_palette.ps1` asserts that the shared palette tokens, status pill colours and the hosting-request card styles are still present in `style.css`, `admin.html` and `script.js`.

---

## 🧭 Known Limitations and Roadmap

- [ ] Enforce the one-way phase order in `PUT /api/admin/elections/<id>/status` (`ALLOWED_ELECTION_TRANSITIONS` is defined in `app.py` but not yet applied).
- [ ] Move pending registrations and login-attempt counters from process memory to a shared store, so restarts and multiple workers do not lose or split state.
- [ ] Replace the hard-coded Super Admin email with configuration or a database role.
- [ ] Run behind a production WSGI server with HTTPS and `SESSION_COOKIE_SECURE`.
- [ ] Add automated tests for the API and the voting flow.
- [ ] Remove or update the legacy `register.html`, which does not match the current registration API.

---

## 🤝 Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature`.
3. Make your changes. Keep schema changes in `database/schema.sql` and document new endpoints in this README.
4. Run `python test_db.py` and `.\test_palette.ps1` where relevant, and manually test the affected flows.
5. Commit: `git commit -m "Add your feature"`.
6. Push: `git push origin feature/your-feature`.
7. Open a Pull Request describing the change and how you tested it.

Please open an issue first for major changes so the approach can be discussed. Never commit `.env`, credentials or real voter data. Report security vulnerabilities privately to the contact below rather than in a public issue.

---

## 📄 License

`[LICENSE_TYPE]` — see the [LICENSE](LICENSE) file for details. Until a license file is added, all rights are reserved by default.

---

## 📬 Contact

**Varun Gupta** — [varun.vip2811@gmail.com](mailto:varun.vip2811@gmail.com) · [GitHub](https://github.com/VarunGupta2811)