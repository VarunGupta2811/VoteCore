from flask import Flask, request, jsonify, session
from flask_cors import CORS
import oracledb
import bcrypt
import os
import uuid
import secrets
import re
import time
import smtplib
from email.mime.text import MIMEText
from dotenv import load_dotenv
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
app = Flask(__name__)

# ============================================================
# FLASK & DB CONFIGURATION
# ============================================================
app.secret_key = os.getenv("FLASK_SECRET_KEY")
if not app.secret_key:
    raise RuntimeError("FLASK_SECRET_KEY must be configured.")
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
CORS(app, supports_credentials=True, origins=["http://127.0.0.1:5500", "http://localhost:5500", "http://127.0.0.1:5501", "http://localhost:5501"])

DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_DSN = os.getenv("DB_DSN")
LOGIN_WINDOW_SECONDS = 15 * 60
MAX_LOGIN_ATTEMPTS = 5
MAX_OTP_ATTEMPTS = 5
failed_login_attempts = {}
ALLOWED_ELECTION_TRANSITIONS = {
    "UPCOMING": "NOMINATION",
    "NOMINATION": "ACTIVE",
    "ACTIVE": "COMPLETED",
}

def get_connection(): return oracledb.connect(user=DB_USER, password=DB_PASSWORD, dsn=DB_DSN)

def request_json():
    return request.get_json(silent=True) or {}

def clean_text(value, field, maximum, required=True):
    if not isinstance(value, str):
        if required:
            raise ValueError(f"{field} is required.")
        return ""
    value = value.strip()
    if required and not value:
        raise ValueError(f"{field} is required.")
    if len(value) > maximum:
        raise ValueError(f"{field} is too long.")
    return value

def login_rate_limited(email):
    key = (request.remote_addr or "unknown", email.lower())
    now = time.monotonic()
    attempts = [t for t in failed_login_attempts.get(key, []) if now - t < LOGIN_WINDOW_SECONDS]
    failed_login_attempts[key] = attempts
    return len(attempts) >= MAX_LOGIN_ATTEMPTS

def record_failed_login(email):
    key = (request.remote_addr or "unknown", email.lower())
    failed_login_attempts.setdefault(key, []).append(time.monotonic())

def clear_failed_logins(email):
    failed_login_attempts.pop((request.remote_addr or "unknown", email.lower()), None)

def can_manage_org(cursor, orgid, pid):
    """Return whether the current administrator can manage an organization."""
    if session.get("is_super_admin"):
        return True
    cursor.execute(
        """SELECT COUNT(*)
           FROM MEMBER_ROLES MR
           JOIN ROLE R ON R.ROLE_ID = MR.ROLE_ID
           WHERE MR.ORGID = :1 AND MR.PID = :2
             AND UPPER(R.ROLE_NAME) IN ('ORGANIZER', 'ADMIN')""",
        (orgid, pid),
    )
    return cursor.fetchone()[0] > 0

def can_manage_election(cursor, election_id, pid):
    cursor.execute("SELECT ORGID FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
    election = cursor.fetchone()
    return bool(election) and can_manage_org(cursor, election[0], pid)

@app.before_request
def validate_server_session():
    """Reject revoked or expired database sessions for all protected API calls."""
    public_paths = {"/api/auth/register", "/api/auth/login", "/api/auth/verify-otp"}
    if not request.path.startswith("/api/") or request.path in public_paths:
        return None
    if not session.get("logged_in") or not session.get("db_session_id"):
        return jsonify({"error": "Unauthorized"}), 401

    conn = cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT COUNT(*) FROM USER_SESSIONS
               WHERE SESSION_ID = :1 AND PID = :2 AND IS_ACTIVE = 1
                 AND SYSTIMESTAMP <= EXPIRES_AT""",
            (session["db_session_id"], session["pid"]),
        )
        if cursor.fetchone()[0] != 1:
            session.clear()
            return jsonify({"error": "Session expired. Please sign in again."}), 401
    except Exception:
        return jsonify({"error": "Authentication service is temporarily unavailable."}), 503
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        csrf_token = request.headers.get("X-CSRF-Token", "")
        if not session.get("csrf_token") or not secrets.compare_digest(csrf_token, session["csrf_token"]):
            return jsonify({"error": "Invalid security token. Refresh the page and try again."}), 403
    return None

def smtp_is_configured():
    return bool(os.getenv("SMTP_EMAIL") and os.getenv("SMTP_PASSWORD"))

def send_otp_email(receiver_email, otp_code, user_name):
    sender_email = os.getenv("SMTP_EMAIL")
    sender_password = os.getenv("SMTP_PASSWORD")
    if not sender_email or not sender_password:
        return False
    msg = MIMEText(f"Hello {user_name},\n\nYour VoteCore login OTP is: {otp_code}\n\nIt expires in 10 minutes.")
    msg['Subject'] = 'VoteCore - Login OTP Verification'; msg['From'] = sender_email; msg['To'] = receiver_email
    timeout = int(os.getenv("SMTP_TIMEOUT", "45"))
    for attempt in range(2):
        server = None
        try:
            server = smtplib.SMTP(os.getenv("SMTP_SERVER", "smtp.gmail.com"), int(os.getenv("SMTP_PORT", 587)), timeout=timeout)
            server.ehlo(); server.starttls(); server.ehlo()
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, [receiver_email], msg.as_string())
            return True
        except (OSError, smtplib.SMTPException):
            app.logger.warning("OTP email delivery attempt %s failed", attempt + 1, exc_info=True)
        finally:
            if server:
                try:
                    server.quit()
                except (OSError, smtplib.SMTPException):
                    pass
    return False

# ============================================================
# AUTHENTICATION & PROFILE
# ============================================================
@app.route("/api/auth/register", methods=["POST"])
def register():
    conn = None; cursor = None
    try:
        data = request_json()
        first_name = clean_text(data.get("first_name"), "First name", 80)
        last_name = clean_text(data.get("last_name"), "Last name", 80)
        mobile = clean_text(data.get("mobile"), "Mobile number", 15)
        email = clean_text(data.get("email"), "Email", 254).lower()
        password = data.get("password")
        dob_str = clean_text(data.get("dob"), "Date of birth", 10)
        aadhaar = clean_text(data.get("aadhaar"), "Government ID number", 12)
        voter_id = clean_text(data.get("voter_id"), "Voter ID", 20).upper()
        if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
            return jsonify({"error": "Password must be between 8 and 128 characters."}), 400
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            return jsonify({"error": "Enter a valid email address."}), 400
        if not re.fullmatch(r"\d{10,15}", mobile):
            return jsonify({"error": "Enter a valid mobile number."}), 400
        if not re.fullmatch(r"\d{12}", aadhaar) or not re.fullmatch(r"[A-Z]{3}\d{7,10}", voter_id):
            return jsonify({"error": "Government ID or voter ID format is invalid."}), 400

        dob_obj = datetime.strptime(dob_str, "%Y-%m-%d")
        age = datetime.today().year - dob_obj.year - ((datetime.today().month, datetime.today().day) < (dob_obj.month, dob_obj.day))
        if age < 18: return jsonify({"error": f"Registration denied. Must be 18+."}), 403

        conn = get_connection(); cursor = conn.cursor()
        hashed_pw = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        
        hashed_voter_id = bcrypt.hashpw(voter_id.strip().upper().encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        hashed_aadhaar = bcrypt.hashpw(aadhaar.strip().encode("utf-8"), bcrypt.gensalt()).decode("utf-8") if aadhaar else None
        
        pid_var = cursor.var(oracledb.NUMBER)
        cursor.execute("INSERT INTO UACCOUNT (FIRST_NAME, LAST_NAME, MOBILE, EMAIL, PASSWORD_HASH, IS_ACTIVE) VALUES (:1, :2, :3, :4, :5, 1) RETURNING PID INTO :6", 
                       (first_name, last_name, mobile, email, hashed_pw, pid_var))
        new_pid = pid_var.getvalue()[0]
        
        cursor.execute("INSERT INTO GOV_IDENTITY (PID, EPIC_ID, AADHAAR_NO, FULL_NAME, DOB, IS_VERIFIED) VALUES (:1, :2, :3, :4, TO_DATE(:5, 'YYYY-MM-DD'), 1)", 
                       (new_pid, hashed_voter_id, hashed_aadhaar, f"{first_name} {last_name}", dob_str))
        cursor.execute("INSERT INTO IDENTITY_WALLET (PID, IDENTITY_TYPE, EPIC_ID) VALUES (:1, 'GOV', :2)", (new_pid, hashed_voter_id))
        conn.commit()
        return jsonify({"message": "Registration successful"}), 201
    except ValueError as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 400
    except Exception:
        if conn: conn.rollback()
        return jsonify({"error": "Unable to complete registration."}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route("/api/auth/login", methods=["POST"])
def login():
    conn = cursor = None
    try:
        data = request_json()
        email, password = clean_text(data.get("email"), "Email", 254).lower(), data.get("password", "")
        if not isinstance(password, str) or not password:
            return jsonify({"error": "Invalid credentials"}), 401
        if login_rate_limited(email):
            return jsonify({"error": "Too many sign-in attempts. Please try again later."}), 429
        if not smtp_is_configured():
            return jsonify({"error": "OTP email delivery is not configured. Add SMTP_EMAIL and SMTP_PASSWORD to backend/.env, then restart the backend."}), 503
        conn = get_connection(); cursor = conn.cursor()
        cursor.execute("SELECT PID, FIRST_NAME, PASSWORD_HASH, IS_ACTIVE FROM UACCOUNT WHERE LOWER(EMAIL) = LOWER(:1)", (email,))
        row = cursor.fetchone()
        
        if not row or not row[3] or not bcrypt.checkpw(password.encode("utf-8"), row[2].encode("utf-8")):
            record_failed_login(email)
            return jsonify({"error": "Invalid credentials"}), 401
        clear_failed_logins(email)

        otp_code = str(secrets.randbelow(900000) + 100000)
        if not send_otp_email(email, otp_code, row[1]):
            return jsonify({"error": "We could not deliver the OTP email. Check the SMTP settings and try again."}), 503
        cursor.execute("UPDATE OTP_VERIFICATION SET VERIFIED = 1 WHERE PID = :1 AND VERIFIED = 0", (row[0],))
        cursor.execute("INSERT INTO OTP_VERIFICATION (PID, OTP_CODE, EXPIRES_AT) VALUES (:1, :2, SYSTIMESTAMP + INTERVAL '10' MINUTE)", (row[0], otp_code))
        conn.commit()
        session["temp_pid"] = row[0]
        session["otp_attempts"] = 0
        return jsonify({"requires_otp": True}), 200
    except ValueError:
        return jsonify({"error": "Invalid credentials"}), 401
    except Exception:
        return jsonify({"error": "Unable to process sign-in."}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@app.route("/api/auth/verify-otp", methods=["POST"])
def verify_otp():
    conn = cursor = None
    try:
        user_otp = clean_text(request_json().get("otp"), "OTP", 6)
        pid = session.get("temp_pid")
        if not pid: return jsonify({"error": "Session expired."}), 401
        if not re.fullmatch(r"\d{6}", user_otp):
            return jsonify({"error": "Invalid or expired OTP."}), 401
        if session.get("otp_attempts", 0) >= MAX_OTP_ATTEMPTS:
            session.pop("temp_pid", None)
            session.pop("otp_attempts", None)
            return jsonify({"error": "Too many OTP attempts. Please sign in again."}), 429

        conn = get_connection(); cursor = conn.cursor()
        cursor.execute("SELECT OTP_ID, OTP_CODE FROM OTP_VERIFICATION WHERE PID = :1 AND VERIFIED = 0 AND SYSTIMESTAMP <= EXPIRES_AT ORDER BY CREATED_AT DESC FETCH FIRST 1 ROWS ONLY", (pid,))
        row = cursor.fetchone()
        if not row or row[1] != user_otp:
            session["otp_attempts"] = session.get("otp_attempts", 0) + 1
            return jsonify({"error": "Invalid or expired OTP."}), 401
        
        cursor.execute("UPDATE OTP_VERIFICATION SET VERIFIED = 1 WHERE OTP_ID = :1", (row[0],))
        cursor.execute("SELECT FIRST_NAME, LAST_NAME, EMAIL FROM UACCOUNT WHERE PID = :1", (pid,))
        user_row = cursor.fetchone()
        
        is_super_admin = (user_row[2].lower() == 'varun.vip2811@gmail.com')
        cursor.execute("SELECT COUNT(*) FROM MEMBER_ROLES M JOIN ROLE R ON M.ROLE_ID = R.ROLE_ID WHERE M.PID = :1 AND UPPER(R.ROLE_NAME) IN ('ORGANIZER', 'ADMIN')", (pid,))
        is_organizer = cursor.fetchone()[0] > 0
        
        db_session_id = str(uuid.uuid4())
        cursor.execute("INSERT INTO USER_SESSIONS (SESSION_ID, PID, EXPIRES_AT, IS_ACTIVE) VALUES (:1, :2, SYSTIMESTAMP + INTERVAL '1' DAY, 1)", (db_session_id, pid))
        conn.commit()

        session.clear()
        csrf_token = secrets.token_urlsafe(32)
        session.update({"logged_in": True, "pid": int(pid), "email": user_row[2], "first_name": user_row[0], "last_name": user_row[1], "is_organizer": is_organizer, "is_super_admin": is_super_admin, "db_session_id": db_session_id, "csrf_token": csrf_token})
        return jsonify({"message": "Login successful", "csrf_token": csrf_token, "user": {"pid": int(pid), "is_organizer": is_organizer, "is_super_admin": is_super_admin}}), 200
    except ValueError:
        return jsonify({"error": "Invalid or expired OTP."}), 401
    except Exception:
        return jsonify({"error": "Unable to verify OTP."}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@app.route("/api/auth/me", methods=["GET"])
def get_current_user():
    if not session.get("logged_in"): return jsonify({"logged_in": False}), 401
    csrf_token = session.get("csrf_token")
    if not csrf_token:
        csrf_token = secrets.token_urlsafe(32)
        session["csrf_token"] = csrf_token
    return jsonify({"logged_in": True, "csrf_token": csrf_token, "user": {"pid": session.get("pid"), "is_organizer": session.get("is_organizer", False), "is_super_admin": session.get("is_super_admin", False)}}), 200

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session_id = session.get("db_session_id")
    if session_id:
        conn = cursor = None
        try:
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute("UPDATE USER_SESSIONS SET IS_ACTIVE = 0 WHERE SESSION_ID = :1", (session_id,))
            conn.commit()
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    session.clear()
    return jsonify({"message": "Logout successful"}), 200

@app.route("/api/auth/logout-all", methods=["POST"])
def logout_all():
    conn = cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE USER_SESSIONS SET IS_ACTIVE = 0 WHERE PID = :1 AND IS_ACTIVE = 1", (session["pid"],))
        conn.commit()
        session.clear()
        return jsonify({"message": "All active sessions have been signed out."}), 200
    except Exception:
        if conn:
            conn.rollback()
        return jsonify({"error": "Unable to sign out all devices."}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@app.route("/api/auth/profile", methods=["GET", "PUT"])
def profile_manager():
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    conn = get_connection(); cursor = conn.cursor()
    
    try:
        if request.method == "GET":
            cursor.execute("""
                SELECT U.FIRST_NAME, U.LAST_NAME, U.MOBILE, U.EMAIL, U.COUNTRY, U.STATE, G.EPIC_ID, G.AADHAAR_NO, G.IS_VERIFIED
                FROM UACCOUNT U LEFT JOIN GOV_IDENTITY G ON U.PID = G.PID WHERE U.PID = :1
            """, (session.get("pid"),))
            row = cursor.fetchone()
            cursor.execute("SELECT O.ORG_NAME, R.ROLE_NAME FROM ORG_MEMBERS OM JOIN ORGANIZATION O ON OM.ORGID = O.ORGID LEFT JOIN MEMBER_ROLES MR ON OM.ORGID = MR.ORGID AND OM.PID = MR.PID LEFT JOIN ROLE R ON MR.ROLE_ID = R.ROLE_ID WHERE OM.PID = :1", (session.get("pid"),))
            orgs = [{"org_name": r[0], "role": r[1] or "Member"} for r in cursor.fetchall()]
            
            return jsonify({"profile": {
                "mobile": row[2], "email": row[3], "country": row[4], "state": row[5],
                "voter_id": "Linked (Protected)" if row[6] else "Not Linked",
                "aadhaar": "Linked (Protected)" if row[7] else "Not Linked",
                "is_verified": bool(row[8]), "organizations": orgs
            }}), 200

        elif request.method == "PUT":
            data = request_json()
            mobile = clean_text(data.get("mobile"), "Mobile number", 15)
            country = clean_text(data.get("country"), "Country", 80)
            state = clean_text(data.get("state"), "State", 80)
            email = data.get("email")
            if not re.fullmatch(r"\d{10,15}", mobile):
                return jsonify({"error": "Enter a valid mobile number."}), 400
            if email is not None:
                email = clean_text(email, "Email", 254).lower()
                if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
                    return jsonify({"error": "Enter a valid email address."}), 400
            
            cursor.execute("""
                UPDATE UACCOUNT
                SET MOBILE = NVL(:1, MOBILE), EMAIL = NVL(:2, EMAIL), COUNTRY = NVL(:3, COUNTRY), STATE = NVL(:4, STATE)
                WHERE PID = :5
            """, (mobile, email, country, state, session.get("pid")))
            conn.commit()
            return jsonify({"message": "Profile updated successfully."}), 200

    except ValueError as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 400
    except Exception:
        if conn: conn.rollback()
        return jsonify({"error": "Unable to update profile."}), 500
    finally:
        cursor.close(); conn.close()

# ============================================================
# ELECTIONS & VOTING (SECURED USING ORIGINAL ER SCHEMA)
# ============================================================
@app.route("/api/elections", methods=["GET"])
def get_elections():
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    conn = get_connection(); cursor = conn.cursor()
    cursor.execute("SELECT ELECTION_ID, TITLE, DESCRIPTION, START_DATE, END_DATE, STATUS FROM ELECTION ORDER BY START_DATE DESC")
    elections = [{"election_id": r[0], "title": r[1], "description": r[2], "start_date": r[3].isoformat() if r[3] else None, "end_date": r[4].isoformat() if r[4] else None, "status": r[5]} for r in cursor.fetchall()]
    cursor.close(); conn.close()
    return jsonify({"elections": elections}), 200

@app.route("/api/elections/<int:election_id>", methods=["GET"])
def get_election(election_id):
    conn = get_connection(); cursor = conn.cursor()
    cursor.execute("SELECT ELECTION_ID, TITLE, DESCRIPTION, STATUS FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
    row = cursor.fetchone()
    cursor.close(); conn.close()
    return jsonify({"election": {"election_id": row[0], "title": row[1], "description": row[2], "status": row[3]}}), 200

@app.route("/api/elections/<int:election_id>/candidates", methods=["GET"])
def get_candidates(election_id):
    conn = get_connection(); cursor = conn.cursor()
    cursor.execute("""
        SELECT C.CANDIDATE_ID, U.FIRST_NAME || ' ' || U.LAST_NAME, C.POSITION, C.MANIFESTO 
        FROM CANDIDATE C JOIN UACCOUNT U ON C.PID = U.PID 
        WHERE C.ELECTION_ID = :1 AND C.STATUS = 'ACTIVE' ORDER BY C.CANDIDATE_ID
    """, (election_id,))
    candidates = [{"candidate_id": r[0], "name": r[1], "position": r[2], "manifesto": r[3]} for r in cursor.fetchall()]
    cursor.close(); conn.close()
    return jsonify({"candidates": candidates}), 200

@app.route("/api/elections/<int:election_id>/vote", methods=["POST"])
def cast_vote(election_id):
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    candidate_id = request_json().get("candidate_id")
    pid = session.get("pid")
    
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute(
            """SELECT STATUS,
                      CASE WHEN (START_DATE IS NULL OR SYSTIMESTAMP >= START_DATE)
                                  AND (END_DATE IS NULL OR SYSTIMESTAMP <= END_DATE)
                           THEN 1 ELSE 0 END
               FROM ELECTION WHERE ELECTION_ID = :1""",
            (election_id,),
        )
        elec = cursor.fetchone()
        if not elec or elec[0] != "ACTIVE":
            return jsonify({"error": "Voting is closed. This election is not in the ACTIVE phase."}), 400
        if elec[1] != 1:
            return jsonify({"error": "Voting is unavailable outside this election's scheduled window."}), 400

        cursor.execute(
            "SELECT COUNT(*) FROM CANDIDATE WHERE CANDIDATE_ID = :1 AND ELECTION_ID = :2 AND STATUS = 'ACTIVE'",
            (candidate_id, election_id),
        )
        if cursor.fetchone()[0] != 1:
            return jsonify({"error": "Invalid candidate for this active election."}), 400

        # Conditional update makes the entitlement single-use even when two
        # requests arrive concurrently. Only an ELIGIBLE voter may transition.
        cursor.execute(
            "UPDATE EVENT_PARTICIPANTS SET STATUS = 'VOTED' "
            "WHERE ELECTION_ID = :1 AND PID = :2 AND STATUS = 'ELIGIBLE'",
            (election_id, pid),
        )
        if cursor.rowcount != 1:
            cursor.execute("SELECT STATUS FROM EVENT_PARTICIPANTS WHERE ELECTION_ID = :1 AND PID = :2", (election_id, pid))
            participant = cursor.fetchone()
            if not participant:
                return jsonify({"error": "Access denied: you are not on the approved voter roll for this election."}), 403
            return jsonify({"error": "Your voting entitlement has already been used or is inactive."}), 409

        cursor.execute("INSERT INTO VOTE (ELECTION_ID, CANDIDATE_ID, VOTED_AT) VALUES (:1, :2, SYSTIMESTAMP)", (election_id, candidate_id))
        
        conn.commit()
        return jsonify({"message": "Vote cast successfully"}), 200
    except Exception:
        if conn: conn.rollback()
        return jsonify({"error": "Unable to record your ballot. Please try again."}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/self-nominate", methods=["POST"])
def self_nominate(election_id):
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    data = request_json()
    try:
        position = clean_text(data.get("position"), "Position", 100)
        manifesto = clean_text(data.get("manifesto", ""), "Manifesto", 1_500, required=False)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    pid = session.get("pid")

    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT STATUS FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        election = cursor.fetchone()
        if not election or election[0] != 'NOMINATION':
            return jsonify({"error": "This election is not currently accepting nominations."}), 400
        cursor.execute(
            "SELECT COUNT(*) FROM EVENT_PARTICIPANTS WHERE ELECTION_ID = :1 AND PID = :2 AND STATUS = 'ELIGIBLE'",
            (election_id, pid),
        )
        if cursor.fetchone()[0] != 1:
            return jsonify({"error": "You must be on this election's approved voter roll to nominate yourself."}), 403

        cursor.execute("INSERT INTO CANDIDATE (ELECTION_ID, PID, POSITION, MANIFESTO, STATUS) VALUES (:1, :2, :3, :4, 'PENDING')", (election_id, pid, position, manifesto))
        conn.commit()
        return jsonify({"message": "Nomination submitted! Pending Organizer approval."}), 201
    except oracledb.IntegrityError:
        if conn: conn.rollback(); return jsonify({"error": "You are already a candidate."}), 409
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/results", methods=["GET"])
def get_results(election_id):
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT STATUS FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        election = cursor.fetchone()
        if not election:
            return jsonify({"error": "Election not found."}), 404
        if election[0] != "COMPLETED":
            return jsonify({"error": "Results are published only after the election is completed."}), 403
        cursor.execute("""
            SELECT C.CANDIDATE_ID, U.FIRST_NAME || ' ' || U.LAST_NAME, C.POSITION,
                   (SELECT COUNT(*) FROM VOTE V WHERE V.CANDIDATE_ID = C.CANDIDATE_ID AND V.ELECTION_ID = C.ELECTION_ID) AS VOTE_COUNT
            FROM CANDIDATE C JOIN UACCOUNT U ON C.PID = U.PID
            WHERE C.ELECTION_ID = :1 ORDER BY VOTE_COUNT DESC
        """, (election_id,))
        results = [{"candidate_name": r[1], "position": r[2], "total_votes": int(r[3])} for r in cursor.fetchall()]
        return jsonify({"results": results}), 200
    finally:
        cursor.close(); conn.close()

# ============================================================
# ORGANIZER CONTROLS (ELECTION & CANDIDATE SCRUTINY)
# ============================================================
@app.route("/api/admin/elections", methods=["POST"])
def create_election():
    if not session.get("is_organizer"): return jsonify({"error": "Unauthorized"}), 403
    data = request_json()
    conn = get_connection(); cursor = conn.cursor()
    try:
        orgid = clean_text(data.get("orgid"), "Organization ID", 40).upper()
        title = clean_text(data.get("title"), "Election title", 160)
        description = clean_text(data.get("description"), "Election description", 2_000)
        if not re.fullmatch(r"[A-Z0-9_]{3,40}", orgid):
            return jsonify({"error": "Organization ID may contain only letters, numbers, and underscores."}), 400
        if not can_manage_org(cursor, orgid, session.get("pid")):
            return jsonify({"error": "Forbidden: you do not manage this organization."}), 403
        cursor.execute("INSERT INTO ELECTION (ORGID, TITLE, DESCRIPTION, START_DATE, STATUS) VALUES (:1, :2, :3, SYSTIMESTAMP, 'UPCOMING')",
                       (orgid, title, description))
        conn.commit(); return jsonify({"message": "Election created as UPCOMING phase."}), 201
    except ValueError as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 400
    except Exception:
        if conn: conn.rollback()
        return jsonify({"error": "Unable to create election."}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/voter-roll", methods=["POST"])
def add_to_voter_roll(election_id):
    if not session.get("is_organizer"): return jsonify({"error": "Unauthorized"}), 403
    
    pid = request_json().get("pid")
    if not isinstance(pid, int) or pid <= 0:
        return jsonify({"error": "Voter PID must be a positive whole number."}), 400

    conn = get_connection(); cursor = conn.cursor()
    try:
        if not can_manage_election(cursor, election_id, session.get("pid")):
            return jsonify({"error": "Forbidden: you do not manage this election."}), 403
        cursor.execute("SELECT COUNT(*) FROM UACCOUNT WHERE PID = :1 AND IS_ACTIVE = 1", (pid,))
        if cursor.fetchone()[0] != 1:
            return jsonify({"error": "The selected voter account is not active."}), 400
        cursor.execute("INSERT INTO EVENT_PARTICIPANTS (ELECTION_ID, PID, STATUS) VALUES (:1, :2, 'ELIGIBLE')", (election_id, pid))
        conn.commit()
        return jsonify({"message": f"Voter {pid} successfully added to the election roll!"}), 200
    except oracledb.IntegrityError:
        if conn: conn.rollback()
        return jsonify({"error": "This voter is already on the roll for this election."}), 409
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/status", methods=["PUT"])
def update_election_status(election_id):
    if not (session.get("is_organizer") or session.get("is_super_admin")):
        return jsonify({"error": "Unauthorized"}), 403
    new_status = request_json().get("status", "").strip().upper()
    if new_status not in ["UPCOMING", "NOMINATION", "ACTIVE", "COMPLETED"]: return jsonify({"error": "Invalid status."}), 400

    pid = session.get("pid")
    conn = get_connection(); cursor = conn.cursor()
    try:
        if not can_manage_election(cursor, election_id, pid):
            return jsonify({"error": "Forbidden: You do not manage the organization that owns this election."}), 403

        cursor.execute("SELECT STATUS FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        election = cursor.fetchone()
        if not election:
            return jsonify({"error": "Election not found."}), 404
        current_status = election[0]
        if ALLOWED_ELECTION_TRANSITIONS.get(current_status) != new_status:
            return jsonify({
                "error": f"Invalid phase change. {current_status} elections may move only to {ALLOWED_ELECTION_TRANSITIONS.get(current_status, 'no further phase')}."
            }), 400

        cursor.execute("UPDATE ELECTION SET STATUS = :1 WHERE ELECTION_ID = :2", (new_status, election_id))
        conn.commit()
        return jsonify({"message": f"Election phase updated to {new_status}!"}), 200
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/pending-candidates", methods=["GET"])
def get_pending_candidates(election_id):
    if not session.get("is_organizer"): return jsonify({"error": "Unauthorized"}), 403
    conn = get_connection(); cursor = conn.cursor()
    if not can_manage_election(cursor, election_id, session.get("pid")):
        cursor.close(); conn.close()
        return jsonify({"error": "Forbidden: you do not manage this election."}), 403
    cursor.execute("""
        SELECT C.CANDIDATE_ID, U.FIRST_NAME || ' ' || U.LAST_NAME, C.POSITION, C.MANIFESTO
        FROM CANDIDATE C JOIN UACCOUNT U ON C.PID = U.PID WHERE C.ELECTION_ID = :1 AND C.STATUS = 'PENDING'
    """, (election_id,))
    candidates = [{"candidate_id": r[0], "name": r[1], "position": r[2], "manifesto": r[3]} for r in cursor.fetchall()]
    cursor.close(); conn.close()
    return jsonify({"pending_candidates": candidates}), 200

@app.route("/api/admin/candidates/<int:candidate_id>/approve", methods=["POST"])
def approve_candidate(candidate_id):
    if not session.get("is_organizer"): return jsonify({"error": "Unauthorized"}), 403
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute(
            """SELECT C.ELECTION_ID, C.STATUS, E.STATUS
               FROM CANDIDATE C JOIN ELECTION E ON E.ELECTION_ID = C.ELECTION_ID
               WHERE C.CANDIDATE_ID = :1""",
            (candidate_id,),
        )
        candidate = cursor.fetchone()
        if not candidate or not can_manage_election(cursor, candidate[0], session.get("pid")):
            return jsonify({"error": "Forbidden: you do not manage this candidate's election."}), 403
        if candidate[1] != "PENDING" or candidate[2] != "NOMINATION":
            return jsonify({"error": "Only pending candidates may be approved during the nomination phase."}), 400
        cursor.execute("UPDATE CANDIDATE SET STATUS = 'ACTIVE' WHERE CANDIDATE_ID = :1", (candidate_id,))
        conn.commit(); return jsonify({"message": "Candidate approved and added to ballot!"}), 200
    finally:
        cursor.close(); conn.close()

# ============================================================
# SUPER ADMIN CONTROLS (ORG APPROVALS & LOGS)
# ============================================================
@app.route("/api/organizations/request", methods=["POST"])
def request_organization():
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    data = request_json()
    try:
        orgid = clean_text(data.get("orgid"), "Organization ID", 40).upper()
        org_name = clean_text(data.get("org_name"), "Organization name", 160)
        org_email = clean_text(data.get("org_email"), "Organization email", 254).lower()
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if not re.fullmatch(r"[A-Z0-9_]{3,40}", orgid) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", org_email):
        return jsonify({"error": "Organization ID or contact email format is invalid."}), 400
    pid = session.get("pid")
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO ORGANIZATION (ORGID, ORG_NAME, ORG_EMAIL, IS_ACTIVE) VALUES (:1, :2, :3, 0)", (orgid, org_name, org_email))
        cursor.execute("INSERT INTO ORG_MEMBERS (ORGID, PID, MEMBER_STATUS) VALUES (:1, :2, 'ACTIVE')", (orgid, pid))
        cursor.execute("SELECT ROLE_ID FROM ROLE WHERE ROLE_NAME = 'ADMIN'")
        cursor.execute("INSERT INTO MEMBER_ROLES (ORGID, PID, ROLE_ID) VALUES (:1, :2, :3)", (orgid, pid, cursor.fetchone()[0]))
        conn.commit(); return jsonify({"message": "Organization requested! Pending Super Admin approval."}), 201
    except oracledb.IntegrityError:
        if conn: conn.rollback(); return jsonify({"error": "This Organization ID is already taken."}), 409
    except Exception:
        if conn: conn.rollback()
        return jsonify({"error": "Unable to submit the organization request."}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/pending-orgs", methods=["GET"])
def get_pending_orgs():
    if not session.get("is_super_admin"): return jsonify({"error": "Super Admin Access Required"}), 403
    conn = get_connection(); cursor = conn.cursor()
    cursor.execute("SELECT ORGID, ORG_NAME, ORG_EMAIL FROM ORGANIZATION WHERE IS_ACTIVE = 0")
    orgs = [{"orgid": r[0], "org_name": r[1], "org_email": r[2]} for r in cursor.fetchall()]
    cursor.close(); conn.close()
    return jsonify({"pending_orgs": orgs}), 200

@app.route("/api/admin/approve-org/<orgid>", methods=["POST"])
def approve_org(orgid):
    if not session.get("is_super_admin"): return jsonify({"error": "Super Admin Access Required"}), 403
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("UPDATE ORGANIZATION SET IS_ACTIVE = 1 WHERE ORGID = :1", (orgid,))
        conn.commit(); return jsonify({"message": f"{orgid} approved and activated!"}), 200
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/audit-logs", methods=["GET"])
def get_audit_logs():
    if not session.get("is_super_admin"): return jsonify({"error": "Super Admin Access Required"}), 403
    conn = get_connection(); cursor = conn.cursor()
    cursor.execute("SELECT A.LOG_ID, U.FIRST_NAME, A.ACTION_TYPE, A.DETAILS, TO_CHAR(A.ACTION_TIME, 'YYYY-MM-DD HH24:MI:SS') FROM AUDIT_LOGS A JOIN UACCOUNT U ON A.PID = U.PID ORDER BY A.LOG_ID DESC")
    logs = [{"log_id": r[0], "user_name": r[1], "action_type": r[2], "details": r[3], "action_time": r[4]} for r in cursor.fetchall()]
    cursor.close(); conn.close()
    return jsonify({"audit_logs": logs}), 200

@app.route("/api/admin/fraud-logs", methods=["GET"])
def get_fraud_logs():
    if not session.get("is_super_admin"): return jsonify({"error": "Super Admin Access Required"}), 403
    conn = get_connection(); cursor = conn.cursor()
    cursor.execute("SELECT F.FRAUD_ID, U.FIRST_NAME, F.FRAUD_TYPE, F.DESCRIPTION, TO_CHAR(F.DETECTED_AT, 'YYYY-MM-DD HH24:MI:SS') FROM FRAUD_LOGS F JOIN UACCOUNT U ON F.PID = U.PID ORDER BY F.FRAUD_ID DESC")
    logs = [{"fraud_id": r[0], "user_name": r[1], "fraud_type": r[2], "description": r[3], "detected_at": r[4]} for r in cursor.fetchall()]
    cursor.close(); conn.close()
    return jsonify({"fraud_logs": logs}), 200

if __name__ == "__main__":
    print("\n--------------------------------------------")
    print("VoteCore REAL ELECTION Backend RUNNING")
    port = int(os.getenv("VOTECORE_PORT", "5000"))
    print(f"Port: {port}")
    print("--------------------------------------------\n")
    app.run(host="127.0.0.1", port=port, debug=os.getenv("FLASK_DEBUG") == "1")
