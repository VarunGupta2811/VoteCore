# 🗳️ VoteCore

> **Enterprise-Grade Platform-as-a-Service (PaaS) Voting Architecture**

VoteCore is a full-stack, multi-tenant digital voting platform designed to execute secure, phase-locked elections. Built on a robust Python/Flask backend and an Oracle Database, it features strict Role-Based Access Control (RBAC), cryptographic identity verification, and an immutable audit trail to ensure absolute election integrity.

## 🚀 Core Architecture & Features

* **Multi-Tenant PaaS Model:** Users can request the creation of independent organizations (e.g., student councils, corporate boards). Upon Super Admin approval, the system dynamically provisions an isolated environment and automatically promotes the requester to `ORGANIZER`.
* **Role-Based Access Control (RBAC):** 
  * **Super Admin:** Global oversight, organization approval, and fraud monitoring.
  * **Organizer:** Election creation, phase management, and candidate scrutiny.
  * **Voter:** Secure ballot casting and real-time result tracking.
* **State-Machine Lifecycle:** Elections are cryptographically locked into strict phases (`UPCOMING` $\rightarrow$ `NOMINATION` $\rightarrow$ `ACTIVE` $\rightarrow$ `COMPLETED`). Actions like candidate registration or ballot casting are rejected at the database level if attempted out-of-phase.
* **Immutable Audit & Fraud Logging:** Automated Oracle PL/SQL triggers actively monitor transactions. Any unauthorized access attempts, phase-bypass attempts, or double-voting anomalies are permanently written to a tamper-proof `FRAUD_LOGS` ledger.
* **"Civic Ledger" UI:** A custom, mobile-first design system utilizing deep ink tones, guilloché seal watermarks, and micro-animations to replicate the gravity and security of physical government documents.

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | HTML + CSS + JavaScript |
| **Backend** | Python + Flask |
| **Database** | Oracle Database |
| **Database interface** | Oracle SQL*Plus |
| **Python $\rightarrow$ Oracle** | `oracledb` Python driver |
| **Authentication** | Flask Sessions + bcrypt |
| **API** | Flask REST API |
| **Testing** | Postman |
| **Version Control** | Git/GitHub |

## 🔒 Security Implementation

VoteCore operates on a Zero-Trust architecture. 
1. **Password Cryptography:** User passwords are encrypted using `bcrypt` before database insertion.
2. **Session Verification:** Access to protected routes requires passing an OTP verification gate, binding the user's validated identity to a secure, server-side Flask session.
3. **Environment Isolation:** Database credentials and API keys are strictly managed via `.env` files and excluded from version control.

## 💻 Local Setup & Installation

**1. Clone the repository:**
```bash
git clone [https://github.com/VarunGupta2811/VoteCore.git](https://github.com/VarunGupta2811/VoteCore.git)
cd VoteCore