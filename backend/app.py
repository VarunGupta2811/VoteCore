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
if not app.secret_key: raise RuntimeError("FLASK_SECRET_KEY must be configured.")
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
CORS(app, supports_credentials=True, origins=["http://127.0.0.1:5500", "http://localhost:5500", "http://127.0.0.1:5501", "http://localhost:5501"])

DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_DSN = os.getenv("DB_DSN")
LOGIN_WINDOW_SECONDS = 15 * 60
MAX_LOGIN_ATTEMPTS = 5
MAX_OTP_ATTEMPTS = 5
failed_login_attempts = {}

# Holds user registration data temporarily until OTP is verified
pending_registrations = {} 

ALLOWED_ELECTION_TRANSITIONS = {
    "UPCOMING": "NOMINATION",
    "NOMINATION": "ACTIVE",
    "ACTIVE": "COMPLETED",
}

def get_connection(): return oracledb.connect(user=DB_USER, password=DB_PASSWORD, dsn=DB_DSN)

def request_json(): return request.get_json(silent=True) or {}

def clean_text(value, field, maximum, required=True):
    if not isinstance(value, str):
        if required: raise ValueError(f"{field} is required.")
        return ""
    value = value.strip()
    if required and not value: raise ValueError(f"{field} is required.")
    if len(value) > maximum: raise ValueError(f"{field} is too long.")
    return value

@app.before_request
def validate_server_session():
    public_paths = {"/api/auth/register", "/api/auth/register-verify", "/api/auth/login", "/api/auth/verify-otp"}
    if request.method == "OPTIONS" or not request.path.startswith("/api/") or request.path in public_paths: return None
    if not session.get("logged_in") or not session.get("db_session_id"): return jsonify({"error": "Unauthorized"}), 401

    conn = cursor = None
    try:
        conn = get_connection(); cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM USER_SESSIONS WHERE SESSION_ID = :1 AND PID = :2 AND IS_ACTIVE = 1 AND SYSTIMESTAMP <= EXPIRES_AT", (session["db_session_id"], session["pid"]))
        if cursor.fetchone()[0] != 1:
            session.clear()
            return jsonify({"error": "Session expired. Please sign in again."}), 401
    except Exception: return jsonify({"error": "Authentication service is temporarily unavailable."}), 503
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.path != "/api/auth/logout":
        csrf_token = request.headers.get("X-CSRF-Token", "")
        if not session.get("csrf_token") or not secrets.compare_digest(csrf_token, session["csrf_token"]):
            return jsonify({"error": "Invalid security token. Refresh the page and try again."}), 403
    return None

def send_otp_email(receiver_email, otp_code, user_name):
    sender_email = os.getenv("SMTP_EMAIL")
    sender_password = os.getenv("SMTP_PASSWORD")
    if not sender_email or not sender_password: return False
    msg = MIMEText(f"Hello {user_name},\n\nYour VoteCore security OTP is: {otp_code}\n\nIt expires in 10 minutes.")
    msg['Subject'] = 'VoteCore - OTP Verification'; msg['From'] = sender_email; msg['To'] = receiver_email
    for _ in range(2):
        try:
            server = smtplib.SMTP(os.getenv("SMTP_SERVER", "smtp.gmail.com"), int(os.getenv("SMTP_PORT", 587)), timeout=45)
            server.ehlo(); server.starttls(); server.ehlo()
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, [receiver_email], msg.as_string())
            return True
        except Exception: pass
        finally:
            try: server.quit()
            except: pass
    return False

# ============================================================
# AUTHENTICATION & REGISTRATION
# ============================================================
@app.route("/api/auth/register", methods=["POST"])
def register():
    """Step 1: Validate input, generate OTP, and hold data in memory"""
    conn = cursor = None
    try:
        data = request_json()
        first_name = clean_text(data.get("first_name"), "First name", 80)
        email = clean_text(data.get("email"), "Email", 254).lower()
        password = data.get("password", "")
        country = clean_text(data.get("country", "India"), "Country", 80, required=False) or "India"
        state = clean_text(data.get("state"), "State", 80)
        
        password_pattern = re.compile(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$')
        if not password_pattern.match(password):
            return jsonify({"error": "Password must be at least 8 characters long and include an uppercase letter, lowercase letter, number, and special character."}), 400

        conn = get_connection(); cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM UACCOUNT WHERE LOWER(EMAIL) = :1", (email,))
        if cursor.fetchone()[0] > 0:
            return jsonify({"error": "This email is already registered to a VoteCore account."}), 409

        otp_code = str(secrets.randbelow(900000) + 100000)
        if not send_otp_email(email, otp_code, first_name):
            return jsonify({"error": "Failed to send OTP email. Please ensure your email is correct."}), 503

        pending_registrations[email] = {
            "data": data,
            "otp": otp_code,
            "expires": time.monotonic() + 600
        }
        
        return jsonify({"requires_otp": True, "email": email}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route("/api/auth/register-verify", methods=["POST"])
def register_verify():
    """Step 2: Verify OTP and formally write the user to the database with Country & State"""
    conn = cursor = None
    try:
        req_data = request_json()
        email = req_data.get("email", "").lower()
        user_otp = req_data.get("otp", "")

        pending = pending_registrations.get(email)
        if not pending or time.monotonic() > pending["expires"]:
            return jsonify({"error": "Registration session expired. Please start over."}), 400
        if pending["otp"] != user_otp:
            return jsonify({"error": "Invalid OTP."}), 401

        data = pending["data"]
        first_name = clean_text(data.get("first_name"), "First name", 80)
        last_name = clean_text(data.get("last_name"), "Last name", 80)
        mobile = clean_text(data.get("mobile"), "Mobile", 15)
        password = data.get("password")
        dob_str = clean_text(data.get("dob"), "DOB", 10)
        aadhaar = clean_text(data.get("aadhaar"), "ID", 12)
        voter_id = clean_text(data.get("voter_id"), "Voter ID", 20).upper()
        country = clean_text(data.get("country", "India"), "Country", 80, required=False) or "India"
        state = clean_text(data.get("state"), "State", 80)

        conn = get_connection(); cursor = conn.cursor()
        hashed_pw = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        hashed_voter_id = bcrypt.hashpw(voter_id.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        hashed_aadhaar = bcrypt.hashpw(aadhaar.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        
        pid_var = cursor.var(oracledb.NUMBER)
        cursor.execute("""
            INSERT INTO UACCOUNT (FIRST_NAME, LAST_NAME, MOBILE, EMAIL, PASSWORD_HASH, COUNTRY, STATE, IS_ACTIVE) 
            VALUES (:1, :2, :3, :4, :5, :6, :7, 1) RETURNING PID INTO :8
        """, (first_name, last_name, mobile, email, hashed_pw, country, state, pid_var))
        new_pid = int(pid_var.getvalue()[0])
        
        cursor.execute("INSERT INTO GOV_IDENTITY (PID, EPIC_ID, AADHAAR_NO, FULL_NAME, DOB, IS_VERIFIED) VALUES (:1, :2, :3, :4, TO_DATE(:5, 'YYYY-MM-DD'), 1)", 
                       (new_pid, hashed_voter_id, hashed_aadhaar, f"{first_name} {last_name}", dob_str))
        cursor.execute("INSERT INTO IDENTITY_WALLET (PID, IDENTITY_TYPE, EPIC_ID) VALUES (:1, 'GOV', :2)", (new_pid, hashed_voter_id))
        conn.commit()

        del pending_registrations[email]

        return jsonify({"message": "Registration successful!"}), 201
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": f"A database error occurred during finalization: {str(e)}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route("/api/auth/login", methods=["POST"])
def login():
    conn = cursor = None
    try:
        data = request_json()
        email, password = clean_text(data.get("email"), "Email", 254).lower(), data.get("password", "")
        conn = get_connection(); cursor = conn.cursor()
        cursor.execute("SELECT PID, FIRST_NAME, PASSWORD_HASH, IS_ACTIVE FROM UACCOUNT WHERE LOWER(EMAIL) = LOWER(:1)", (email,))
        row = cursor.fetchone()
        
        if not row or not row[3] or not bcrypt.checkpw(password.encode("utf-8"), row[2].encode("utf-8")):
            return jsonify({"error": "Invalid credentials"}), 401

        otp_code = str(secrets.randbelow(900000) + 100000)
        otp_hash = bcrypt.hashpw(otp_code.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        
        if not send_otp_email(email, otp_code, row[1]):
            return jsonify({"error": "We could not deliver the OTP email."}), 503
            
        cursor.execute("UPDATE OTP_VERIFICATION SET VERIFIED = 1 WHERE PID = :1 AND VERIFIED = 0", (row[0],))
        cursor.execute("INSERT INTO OTP_VERIFICATION (PID, OTP_CODE, OTP_CODE_HASH, EXPIRES_AT) VALUES (:1, :2, :3, SYSTIMESTAMP + INTERVAL '10' MINUTE)", (row[0], otp_code, otp_hash))
        conn.commit()
        session["temp_pid"] = row[0]; session["otp_attempts"] = 0
        return jsonify({"requires_otp": True}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route("/api/auth/verify-otp", methods=["POST"])
def verify_otp():
    conn = cursor = None
    try:
        user_otp = request_json().get("otp")
        pid = session.get("temp_pid")
        conn = get_connection(); cursor = conn.cursor()
        
        cursor.execute("SELECT OTP_ID, OTP_CODE, OTP_CODE_HASH FROM OTP_VERIFICATION WHERE PID = :1 AND VERIFIED = 0 AND SYSTIMESTAMP <= EXPIRES_AT ORDER BY CREATED_AT DESC FETCH FIRST 1 ROWS ONLY", (pid,))
        row = cursor.fetchone()
        
        if not row: return jsonify({"error": "Invalid or expired OTP."}), 401
            
        if row[2]:
            if not bcrypt.checkpw(user_otp.encode('utf-8'), row[2].encode('utf-8')): return jsonify({"error": "Invalid or expired OTP."}), 401
        else:
            if row[1] != user_otp: return jsonify({"error": "Invalid or expired OTP."}), 401
        
        cursor.execute("UPDATE OTP_VERIFICATION SET VERIFIED = 1 WHERE OTP_ID = :1", (row[0],))
        cursor.execute("SELECT FIRST_NAME, LAST_NAME, EMAIL FROM UACCOUNT WHERE PID = :1", (pid,))
        user_row = cursor.fetchone()
        
        is_super_admin = (user_row[2].lower() == 'varun.vip2811@gmail.com')
        cursor.execute("SELECT COUNT(*) FROM ELECTION WHERE ORGANIZER_PID = :1", (pid,))
        is_organizer = cursor.fetchone()[0] > 0
        
        db_session_id = str(uuid.uuid4())
        cursor.execute("INSERT INTO USER_SESSIONS (SESSION_ID, PID, EXPIRES_AT, IS_ACTIVE) VALUES (:1, :2, SYSTIMESTAMP + INTERVAL '1' DAY, 1)", (db_session_id, pid))
        conn.commit()

        session.clear()
        csrf_token = secrets.token_urlsafe(32)
        session.update({"logged_in": True, "pid": int(pid), "email": user_row[2], "first_name": user_row[0], "last_name": user_row[1], "is_organizer": is_organizer, "is_super_admin": is_super_admin, "db_session_id": db_session_id, "csrf_token": csrf_token})
        return jsonify({"message": "Login successful", "csrf_token": csrf_token, "user": {"pid": int(pid), "is_organizer": is_organizer, "is_super_admin": is_super_admin}}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route("/api/auth/me", methods=["GET"])
def get_current_user():
    if not session.get("logged_in"): return jsonify({"logged_in": False}), 401
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM ELECTION WHERE ORGANIZER_PID = :1", (session.get("pid"),))
        is_organizer = cursor.fetchone()[0] > 0
        return jsonify({"logged_in": True, "csrf_token": session.get("csrf_token"), "user": {"pid": session.get("pid"), "is_organizer": is_organizer, "is_super_admin": session.get("is_super_admin", False)}}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session_id = session.get("db_session_id")
    if session_id:
        conn = get_connection(); cursor = conn.cursor()
        cursor.execute("UPDATE USER_SESSIONS SET IS_ACTIVE = 0 WHERE SESSION_ID = :1", (session_id,))
        conn.commit(); cursor.close(); conn.close()
    session.clear()
    return jsonify({"message": "Logout successful"}), 200

@app.route("/api/auth/logout-all", methods=["POST"])
def logout_all():
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("UPDATE USER_SESSIONS SET IS_ACTIVE = 0 WHERE PID = :1 AND IS_ACTIVE = 1", (session["pid"],))
        conn.commit()
        session.clear()
        return jsonify({"message": "All active sessions signed out."}), 200
    finally:
        cursor.close(); conn.close()

@app.route("/api/auth/profile", methods=["GET"])
def profile_manager():
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT U.FIRST_NAME, U.LAST_NAME, U.MOBILE, U.EMAIL, U.COUNTRY, U.STATE, G.EPIC_ID, G.AADHAAR_NO, G.IS_VERIFIED
            FROM UACCOUNT U LEFT JOIN GOV_IDENTITY G ON U.PID = G.PID WHERE U.PID = :1
        """, (session.get("pid"),))
        row = cursor.fetchone()
        
        cursor.execute("""
            SELECT O.ORG_NAME, 'PARTY_MEMBER' 
            FROM ELECTION_PARTY_MEMBER EPM 
            JOIN ELECTION_PARTY EP ON EPM.ELECTION_PARTY_ID = EP.ELECTION_PARTY_ID
            JOIN ORGANIZATION O ON EP.ORGID = O.ORGID
            WHERE EPM.PID = :1 AND EPM.STATUS = 'APPROVED'
        """, (session.get("pid"),))
        orgs = [{"org_name": r[0], "role": r[1]} for r in cursor.fetchall()]
        
        return jsonify({"profile": {
            "first_name": row[0], "last_name": row[1],
            "mobile": row[2], "email": row[3], "country": row[4], "state": row[5],
            "voter_id": "Linked (Protected)" if row[6] else "Not Linked",
            "aadhaar": "Linked (Protected)" if row[7] else "Not Linked",
            "is_verified": bool(row[8]), "organizations": orgs
        }}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

# ============================================================
# USER ELECTION WORKFLOW
# ============================================================
@app.route("/api/elections", methods=["GET"])
def get_elections():
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    conn = get_connection(); cursor = conn.cursor()
    try:
        # UPDATED: Filters out ARCHIVED elections from the public dashboard
        cursor.execute("SELECT ELECTION_ID, TITLE, DESCRIPTION, STATUS FROM ELECTION WHERE STATUS != 'ARCHIVED' ORDER BY ELECTION_ID DESC")
        elections = [{"election_id": r[0], "title": r[1], "description": r[2], "status": r[3]} for r in cursor.fetchall()]
        return jsonify({"elections": elections}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>", methods=["GET"])
def get_election(election_id):
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT ELECTION_ID, TITLE, DESCRIPTION, STATUS, ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        row = cursor.fetchone()
        if not row: return jsonify({"error": "Not found"}), 404
        
        voter_status = None
        if session.get("logged_in"):
            cursor.execute("SELECT STATUS FROM EVENT_PARTICIPANTS WHERE ELECTION_ID = :1 AND PID = :2", (election_id, session.get("pid")))
            v_row = cursor.fetchone()
            if v_row: voter_status = v_row[0]
            
        return jsonify({"election": {
            "election_id": row[0], "title": row[1], "description": row[2], 
            "status": row[3], "has_organizer": row[4] is not None, "organizer_pid": row[4],
            "voter_status": voter_status
        }}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/register-voter", methods=["POST"])
def register_voter(election_id):
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    pid = session.get("pid")
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec: return jsonify({"error": "Election not found."}), 404
        if session.get("is_super_admin") or elec[0] == pid:
            return jsonify({"error": "Platform administrators and election organizers cannot participate in elections."}), 403

        cursor.execute("INSERT INTO EVENT_PARTICIPANTS (ELECTION_ID, PID, STATUS) VALUES (:1, :2, 'PENDING')", (election_id, pid))
        conn.commit()
        return jsonify({"message": "Application submitted! Pending Organizer approval."}), 201
    except Exception as e:
        if conn: conn.rollback()
        error_str = str(e).lower()
        if "unique" in error_str or "pk" in error_str or "uk_" in error_str:
            return jsonify({"error": "You have already applied for this voter roll."}), 409
        return jsonify({"error": f"Database Error: {str(e)}"}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/apply-organizer", methods=["POST"])
def apply_organizer(election_id):
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    pid = session.get("pid")
    if session.get("is_super_admin"): 
        return jsonify({"error": "Platform Administrators cannot act as local Organizers."}), 403
        
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO ORGANIZER_APPLICATION (ELECTION_ID, PID, STATUS) VALUES (:1, :2, 'PENDING')", (election_id, pid))
        conn.commit()
        return jsonify({"message": "Application submitted! Pending Super Admin approval."}), 201
    except oracledb.IntegrityError:
        if conn: conn.rollback()
        return jsonify({"error": "You have already applied for this election."}), 409
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/parties", methods=["GET"])
def get_election_parties(election_id):
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT EP.ELECTION_PARTY_ID, O.ORG_NAME, U.FIRST_NAME || ' ' || U.LAST_NAME, EP.LEADER_PID
            FROM ELECTION_PARTY EP JOIN ORGANIZATION O ON EP.ORGID = O.ORGID JOIN UACCOUNT U ON EP.LEADER_PID = U.PID
            WHERE EP.ELECTION_ID = :1 AND EP.STATUS = 'APPROVED'
        """, (election_id,))
        parties = [{"party_id": r[0], "party_name": r[1], "leader_name": r[2], "leader_pid": r[3]} for r in cursor.fetchall()]
        return jsonify({"parties": parties}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/register-party", methods=["POST"])
def register_election_party(election_id):
    """Creates party, and AUTO-NOMINATES the founder for President"""
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    
    data = request_json()
    party_name = data.get("party_name", "").strip()
    manifesto = clean_text(data.get("manifesto", "No manifesto provided."), "Manifesto", 1500, required=False)
    
    if not party_name: return jsonify({"error": "Party name required."}), 400
    pid = session.get("pid")
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT STATUS, ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec or elec[0] != 'NOMINATION': return jsonify({"error": "Parties can only be formed during the NOMINATION phase."}), 400
        if session.get("is_super_admin") or elec[1] == pid: return jsonify({"error": "Administrators and organizers cannot participate."}), 403

        # Step 1: Create Organization & Party
        orgid = "PTY_" + secrets.token_hex(4).upper()
        cursor.execute("INSERT INTO ORGANIZATION (ORGID, ORG_NAME, IS_ACTIVE) VALUES (:1, :2, 1)", (orgid, party_name))
        
        party_id_var = cursor.var(oracledb.NUMBER)
        cursor.execute("INSERT INTO ELECTION_PARTY (ELECTION_ID, ORGID, LEADER_PID, STATUS) VALUES (:1, :2, :3, 'PENDING') RETURNING ELECTION_PARTY_ID INTO :4", 
                       (election_id, orgid, pid, party_id_var))
        party_id = int(party_id_var.getvalue()[0])

        # Step 2: Auto-Nominate Founder as President
        cursor.execute("SELECT POSITION_ID FROM ELECTION_POSITION WHERE ELECTION_ID = :1 AND UPPER(TITLE) = 'PRESIDENT'", (election_id,))
        pos_row = cursor.fetchone()
        if pos_row: 
            pos_id = pos_row[0]
        else:
            cursor.execute("SELECT NVL(MAX(DISPLAY_ORDER), 0) + 1 FROM ELECTION_POSITION WHERE ELECTION_ID = :1", (election_id,))
            next_order = cursor.fetchone()[0]
            pos_id_var = cursor.var(oracledb.NUMBER)
            cursor.execute("INSERT INTO ELECTION_POSITION (ELECTION_ID, TITLE, DISPLAY_ORDER, STATUS) VALUES (:1, 'President', :2, 'OPEN') RETURNING POSITION_ID INTO :3", 
                           (election_id, next_order, pos_id_var))
            pos_id = int(pos_id_var.getvalue()[0])

        # Step 3: Insert Candidate with Custom Manifesto
        cursor.execute("INSERT INTO CANDIDATE (ELECTION_ID, PID, POSITION, POSITION_ID, ELECTION_PARTY_ID, MANIFESTO, STATUS) VALUES (:1, :2, 'President', :3, :4, :5, 'PENDING')", 
                       (election_id, pid, pos_id, party_id, manifesto))

        conn.commit()
        return jsonify({"message": f"'{party_name}' submitted! You have been auto-nominated for President. Pending Organizer approval."}), 201
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/parties/<int:party_id>/join", methods=["POST"])
def join_election_party(election_id, party_id):
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    pid = session.get("pid")
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT STATUS, ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec or elec[0] != 'NOMINATION': return jsonify({"error": "You can only join a party during the NOMINATION phase."}), 400
        if session.get("is_super_admin") or elec[1] == pid: return jsonify({"error": "Administrators and organizers cannot participate."}), 403

        cursor.execute("INSERT INTO ELECTION_PARTY_MEMBER (ELECTION_PARTY_ID, ELECTION_ID, PID, STATUS) VALUES (:1, :2, :3, 'APPROVED')", (party_id, election_id, pid))
        conn.commit()
        return jsonify({"message": "Successfully joined the party! The Party Leader can now assign you a ticket."}), 201
    except oracledb.IntegrityError:
        if conn: conn.rollback()
        return jsonify({"error": "You are already a member of a party in this election."}), 409
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/my-party-members", methods=["GET"])
def get_my_party_members(election_id):
    """Fetches all verified members of the current user's party for delegation"""
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    pid = session.get("pid")
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT ELECTION_PARTY_ID FROM ELECTION_PARTY WHERE ELECTION_ID = :1 AND LEADER_PID = :2 AND STATUS = 'APPROVED'", (election_id, pid))
        party = cursor.fetchone()
        if not party: return jsonify({"error": "You are not an approved party leader."}), 403
        party_id = party[0]

        cursor.execute("""
            SELECT U.PID, U.FIRST_NAME || ' ' || U.LAST_NAME, U.EMAIL 
            FROM ELECTION_PARTY_MEMBER EPM 
            JOIN UACCOUNT U ON EPM.PID = U.PID 
            WHERE EPM.ELECTION_PARTY_ID = :1 AND EPM.STATUS = 'APPROVED'
        """, (party_id,))
        members = [{"pid": r[0], "name": r[1], "email": r[2]} for r in cursor.fetchall()]
        return jsonify({"members": members}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/positions", methods=["GET"])
def get_election_positions(election_id):
    """Fetches all official positions created by the Organizer"""
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT POSITION_ID, TITLE FROM ELECTION_POSITION WHERE ELECTION_ID = :1 AND STATUS = 'OPEN' ORDER BY DISPLAY_ORDER", (election_id,))
        positions = [{"position_id": r[0], "title": r[1]} for r in cursor.fetchall()]
        return jsonify({"positions": positions}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/assign-candidate", methods=["POST"])
def assign_candidate(election_id):
    """EXCLUSIVELY FOR PARTY LEADERS: Assign a party member to a specific ticket"""
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    data = request_json()
    
    try:
        member_pid = int(data.get("member_pid", 0))
    except ValueError:
        return jsonify({"error": "Invalid Member PID."}), 400
        
    position_name = clean_text(data.get("position"), "Position", 100).title()
    manifesto = clean_text(data.get("manifesto", ""), "Manifesto", 1_500, required=False)
    leader_pid = session.get("pid")

    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT STATUS, ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        election = cursor.fetchone()
        if not election or election[0] != 'NOMINATION': return jsonify({"error": "Tickets can only be assigned during the Nomination phase."}), 400
        
        # 1. Verify Requestor is an Approved Party Leader
        cursor.execute("SELECT ELECTION_PARTY_ID FROM ELECTION_PARTY WHERE ELECTION_ID = :1 AND LEADER_PID = :2 AND STATUS = 'APPROVED'", (election_id, leader_pid))
        party = cursor.fetchone()
        if not party: return jsonify({"error": "Access Denied. Only an approved Party Leader can delegate tickets."}), 403
        party_id = party[0]

        # 2. Verify Target Member is in that specific party
        cursor.execute("SELECT STATUS FROM ELECTION_PARTY_MEMBER WHERE ELECTION_PARTY_ID = :1 AND PID = :2", (party_id, member_pid))
        member = cursor.fetchone()
        if not member or member[0] != 'APPROVED': return jsonify({"error": "That user is not an approved member of your party."}), 403

        # 3. Verify Position exists (Strict Organizer Rules)
        cursor.execute("SELECT POSITION_ID FROM ELECTION_POSITION WHERE ELECTION_ID = :1 AND UPPER(TITLE) = UPPER(:2)", (election_id, position_name))
        pos_row = cursor.fetchone()
        if not pos_row: return jsonify({"error": "The Organizer has not opened this position for the election yet."}), 400
        pos_id = pos_row[0]

        cursor.execute("INSERT INTO CANDIDATE (ELECTION_ID, PID, POSITION, POSITION_ID, ELECTION_PARTY_ID, MANIFESTO, STATUS) VALUES (:1, :2, :3, :4, :5, :6, 'PENDING')", 
                       (election_id, member_pid, position_name, pos_id, party_id, manifesto))
        conn.commit()
        return jsonify({"message": f"Member assigned to {position_name} ticket! Pending Organizer scrutiny."}), 201
    except oracledb.IntegrityError:
        if conn: conn.rollback(); return jsonify({"error": "This member already holds a ticket for this position."}), 409
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/candidates", methods=["GET"])
def get_candidates(election_id):
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT C.CANDIDATE_ID, U.FIRST_NAME || ' ' || U.LAST_NAME, POS.TITLE, C.MANIFESTO, O.ORG_NAME
            FROM CANDIDATE C JOIN UACCOUNT U ON C.PID = U.PID JOIN ELECTION_POSITION POS ON C.POSITION_ID = POS.POSITION_ID
            JOIN ELECTION_PARTY EP ON C.ELECTION_PARTY_ID = EP.ELECTION_PARTY_ID JOIN ORGANIZATION O ON EP.ORGID = O.ORGID
            WHERE C.ELECTION_ID = :1 AND C.STATUS = 'ACTIVE' ORDER BY POS.DISPLAY_ORDER, C.CANDIDATE_ID
        """, (election_id,))
        candidates = [{"candidate_id": r[0], "name": f"{r[1]} ({r[4]})", "position": r[2], "manifesto": r[3]} for r in cursor.fetchall()]
        return jsonify({"candidates": candidates}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/vote", methods=["POST"])
def cast_vote(election_id):
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    candidate_id = request_json().get("candidate_id")
    pid = session.get("pid")
    
    conn = get_connection(); cursor = conn.cursor()
    try:
        # 1. Verify Election status and Organizer neutrality
        cursor.execute("SELECT STATUS, ORGANIZER_PID, TITLE FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec or elec[0] != "ACTIVE": 
            return jsonify({"error": "Voting is closed. Phase is not ACTIVE."}), 400
        if session.get("is_super_admin") or elec[1] == pid: 
            return jsonify({"error": "Administrators and organizers cannot vote."}), 403
        election_title = elec[2]

        # 2. Verify Candidate and fetch Position title
        cursor.execute("""
            SELECT C.POSITION_ID, POS.TITLE 
            FROM CANDIDATE C 
            JOIN ELECTION_POSITION POS ON C.POSITION_ID = POS.POSITION_ID 
            WHERE C.CANDIDATE_ID = :1 AND C.ELECTION_ID = :2 AND C.STATUS = 'ACTIVE'
        """, (candidate_id, election_id))
        cand_row = cursor.fetchone()
        if not cand_row: 
            return jsonify({"error": "Invalid candidate."}), 400
        pos_id, pos_title = cand_row[0], cand_row[1]

        # 3. Check if voter already cast a ballot for this specific post
        cursor.execute("UPDATE VOTER_POST_STATUS SET STATUS = 'VOTED', VOTED_AT = SYSTIMESTAMP WHERE ELECTION_ID = :1 AND POSITION_ID = :2 AND PID = :3 AND STATUS = 'ELIGIBLE'", (election_id, pos_id, pid))
        
        if cursor.rowcount == 0:
            cursor.execute("SELECT STATUS FROM VOTER_POST_STATUS WHERE ELECTION_ID = :1 AND POSITION_ID = :2 AND PID = :3", (election_id, pos_id, pid))
            if cursor.fetchone():
                # --- LOG FRAUD ALERT: DUPLICATE VOTE ---
                cursor.execute("""
                    INSERT INTO FRAUD_LOGS (PID, FRAUD_TYPE, DESCRIPTION, DETECTED_AT)
                    VALUES (:1, 'DOUBLE_VOTE_ATTEMPT', :2, SYSTIMESTAMP)
                """, (pid, f"Attempted duplicate vote for '{pos_title}' in election '{election_title}'"))
                conn.commit()
                return jsonify({"error": "You already voted for this position."}), 409
            
            # Check if voter is approved on the voter roll
            cursor.execute("SELECT STATUS FROM EVENT_PARTICIPANTS WHERE ELECTION_ID = :1 AND PID = :2", (election_id, pid))
            v_status = cursor.fetchone()
            if not v_status or v_status[0] != 'ELIGIBLE':
                # --- LOG FRAUD ALERT: UNAUTHORIZED VOTER ---
                cursor.execute("""
                    INSERT INTO FRAUD_LOGS (PID, FRAUD_TYPE, DESCRIPTION, DETECTED_AT)
                    VALUES (:1, 'UNAUTHORIZED_BALLOT', :2, SYSTIMESTAMP)
                """, (pid, f"Unapproved voter attempted to cast ballot in election '{election_title}'"))
                conn.commit()
                return jsonify({"error": "You are not on the approved voter roll."}), 403
            
            cursor.execute("INSERT INTO VOTER_POST_STATUS (ELECTION_ID, POSITION_ID, PID, STATUS, VOTED_AT) VALUES (:1, :2, :3, 'VOTED', SYSTIMESTAMP)", (election_id, pos_id, pid))

        # 4. Cast the anonymous vote
        cursor.execute("INSERT INTO VOTE (ELECTION_ID, CANDIDATE_ID, POSITION_ID, VOTED_AT) VALUES (:1, :2, :3, SYSTIMESTAMP)", (election_id, candidate_id, pos_id))
        conn.commit()
        return jsonify({"message": "Vote cryptographically sealed and cast!"}), 200
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/results", methods=["GET"])
def get_results(election_id):
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT STATUS FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        election = cursor.fetchone()
        if not election: return jsonify({"error": "Not found."}), 404
        if election[0] != "COMPLETED": return jsonify({"error": "Results are published only after completion."}), 403
        
        cursor.execute("""
            SELECT C.CANDIDATE_ID, U.FIRST_NAME || ' ' || U.LAST_NAME, POS.TITLE,
                   (SELECT COUNT(*) FROM VOTE V WHERE V.CANDIDATE_ID = C.CANDIDATE_ID) AS VOTE_COUNT, O.ORG_NAME
            FROM CANDIDATE C JOIN UACCOUNT U ON C.PID = U.PID JOIN ELECTION_POSITION POS ON C.POSITION_ID = POS.POSITION_ID
            JOIN ELECTION_PARTY EP ON C.ELECTION_PARTY_ID = EP.ELECTION_PARTY_ID JOIN ORGANIZATION O ON EP.ORGID = O.ORGID
            WHERE C.ELECTION_ID = :1 AND C.STATUS = 'ACTIVE' ORDER BY POS.DISPLAY_ORDER, VOTE_COUNT DESC
        """, (election_id,))
        results = [{"candidate_name": f"{r[1]} ({r[4]})", "position": r[2], "total_votes": int(r[3])} for r in cursor.fetchall()]
        return jsonify({"results": results}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

# ============================================================
# ADMIN / ORGANIZER ROUTES
# ============================================================
@app.route("/api/admin/elections", methods=["POST"])
def create_election():
    if not session.get("is_super_admin"): return jsonify({"error": "Unauthorized"}), 403
    data = request_json()
    conn = get_connection(); cursor = conn.cursor()
    try:
        orgid = clean_text(data.get("orgid"), "Host Jurisdiction ID", 40).upper()
        title = clean_text(data.get("title"), "Election title", 160)
        description = clean_text(data.get("description"), "Description", 2_000)
        
        cursor.execute("SELECT COUNT(*) FROM ORGANIZATION WHERE ORGID = :1", (orgid,))
        if cursor.fetchone()[0] == 0:
            cursor.execute("INSERT INTO ORGANIZATION (ORGID, ORG_NAME, IS_ACTIVE) VALUES (:1, :2, 1)", (orgid, orgid))

        cursor.execute("INSERT INTO ELECTION (ORGID, TITLE, DESCRIPTION, START_DATE, END_DATE, STATUS) VALUES (:1, :2, :3, SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '7' DAY, 'UPCOMING')",
                       (orgid, title, description))
        conn.commit(); return jsonify({"message": "Election initialized successfully!"}), 201
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>", methods=["DELETE"])
def remove_election(election_id):
    """SUPER ADMIN ONLY: Soft-deletes a completed election from the dashboard"""
    if not session.get("is_super_admin"): return jsonify({"error": "Unauthorized"}), 403
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT STATUS FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        row = cursor.fetchone()
        if not row: return jsonify({"error": "Election not found."}), 404
        if row[0] != 'COMPLETED': return jsonify({"error": "Only COMPLETED elections can be removed."}), 400
        
        # Soft delete: update status to ARCHIVED
        cursor.execute("UPDATE ELECTION SET STATUS = 'ARCHIVED' WHERE ELECTION_ID = :1", (election_id,))
        
        # Write to Audit Trail so the action is permanently recorded
        cursor.execute("INSERT INTO AUDIT_LOGS (PID, ACTION_TYPE, DETAILS, ACTION_TIME) VALUES (:1, 'ELECTION_ARCHIVED', :2, SYSTIMESTAMP)", 
                       (session.get("pid"), f"Super Admin archived completed Election ID {election_id}"))
        
        conn.commit()
        return jsonify({"message": "Election successfully archived and removed from public lists."}), 200
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/pending-organizers", methods=["GET"])
def get_pending_organizers():
    if not session.get("is_super_admin"): return jsonify({"error": "Unauthorized"}), 403
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT OA.APPLICATION_ID, E.TITLE, U.FIRST_NAME || ' ' || U.LAST_NAME, E.ELECTION_ID
            FROM ORGANIZER_APPLICATION OA
            JOIN ELECTION E ON OA.ELECTION_ID = E.ELECTION_ID
            JOIN UACCOUNT U ON OA.PID = U.PID
            WHERE OA.STATUS = 'PENDING' AND E.ORGANIZER_PID IS NULL
        """)
        apps = [{"app_id": r[0], "election_title": r[1], "user_name": r[2], "election_id": r[3]} for r in cursor.fetchall()]
        return jsonify({"pending_organizers": apps}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/approve-organizer/<int:app_id>", methods=["POST"])
def approve_organizer(app_id):
    if not session.get("is_super_admin"): return jsonify({"error": "Unauthorized"}), 403
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT ELECTION_ID, PID FROM ORGANIZER_APPLICATION WHERE APPLICATION_ID = :1 AND STATUS = 'PENDING'", (app_id,))
        row = cursor.fetchone()
        if not row: return jsonify({"error": "Application not found."}), 404
        
        elec_id, applicant_pid = row[0], row[1]
        
        cursor.execute("UPDATE ELECTION SET ORGANIZER_PID = :1, ORGANIZER_APPOINTED_AT = SYSTIMESTAMP, ORGANIZER_APPOINTED_BY = :2 WHERE ELECTION_ID = :3", 
                       (applicant_pid, session.get("pid"), elec_id))
        cursor.execute("UPDATE ORGANIZER_APPLICATION SET STATUS = 'APPROVED', REVIEWED_AT = SYSTIMESTAMP, REVIEWED_BY = :1 WHERE APPLICATION_ID = :2", 
                       (session.get("pid"), app_id))
        cursor.execute("UPDATE ORGANIZER_APPLICATION SET STATUS = 'REJECTED', REASON = 'Position filled' WHERE ELECTION_ID = :1 AND STATUS = 'PENDING'", (elec_id,))
        conn.commit(); return jsonify({"message": "Organizer appointed successfully!"}), 200
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/my-elections", methods=["GET"])
def get_my_elections():
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    conn = get_connection(); cursor = conn.cursor()
    try:
        # UPDATED: Filters out ARCHIVED elections from the Organizer Panel
        cursor.execute("SELECT ELECTION_ID, TITLE, STATUS FROM ELECTION WHERE ORGANIZER_PID = :1 AND STATUS != 'ARCHIVED' ORDER BY ELECTION_ID DESC", (session.get("pid"),))
        elections = [{"election_id": r[0], "title": r[1], "status": r[2]} for r in cursor.fetchall()]
        return jsonify({"my_elections": elections}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/positions", methods=["POST"])
def add_election_position(election_id):
    """ORGANIZER ONLY: Define available ballot positions"""
    if not session.get("is_organizer"): return jsonify({"error": "Unauthorized"}), 403
    title = clean_text(request_json().get("title"), "Position Title", 100).title()
    conn = get_connection(); cursor = conn.cursor()
    try:
        # Fetch both the Organizer PID and the Election Status
        cursor.execute("SELECT ORGANIZER_PID, STATUS FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec or elec[0] != session.get("pid"): return jsonify({"error": "Forbidden."}), 403
        
        # NEW SECURITY CHECK: Block position creation if the election has advanced
        if elec[1] != 'UPCOMING':
            return jsonify({"error": f"Positions cannot be altered while the election is in the {elec[1]} phase."}), 400

        cursor.execute("SELECT NVL(MAX(DISPLAY_ORDER), 0) + 1 FROM ELECTION_POSITION WHERE ELECTION_ID = :1", (election_id,))
        next_order = cursor.fetchone()[0]
        
        cursor.execute("INSERT INTO ELECTION_POSITION (ELECTION_ID, TITLE, DISPLAY_ORDER, STATUS) VALUES (:1, :2, :3, 'OPEN')", (election_id, title, next_order))
        conn.commit(); return jsonify({"message": f"Position '{title}' added successfully!"}), 201
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/pending-voters", methods=["GET"])
def get_pending_voters(election_id):
    if not session.get("is_organizer"): return jsonify({"error": "Unauthorized"}), 403
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec or elec[0] != session.get("pid"): return jsonify({"error": "Forbidden."}), 403
        
        cursor.execute("""
            SELECT EP.PID, U.FIRST_NAME || ' ' || U.LAST_NAME, U.EMAIL 
            FROM EVENT_PARTICIPANTS EP 
            JOIN UACCOUNT U ON EP.PID = U.PID 
            WHERE EP.ELECTION_ID = :1 AND EP.STATUS = 'PENDING'
        """, (election_id,))
        voters = [{"pid": r[0], "name": r[1], "email": r[2]} for r in cursor.fetchall()]
        return jsonify({"pending_voters": voters}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/approve-voter", methods=["POST"])
def approve_voter(election_id):
    if not session.get("is_organizer"): return jsonify({"error": "Unauthorized"}), 403
    pid = request_json().get("pid")
    conn = get_connection(); cursor = conn.cursor()
    try:
        # 1. Fetch Election Title and Organizer PID
        cursor.execute("SELECT ORGANIZER_PID, TITLE FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec or elec[0] != session.get("pid"): return jsonify({"error": "Unauthorized."}), 403
        election_title = elec[1]

        # 2. Fetch Voter Name
        cursor.execute("SELECT FIRST_NAME, LAST_NAME FROM UACCOUNT WHERE PID = :1", (pid,))
        voter_row = cursor.fetchone()
        voter_name = f"{voter_row[0]} {voter_row[1]}".strip() if voter_row else f"PID {pid}"

        # 3. Update Voter Status
        cursor.execute("UPDATE EVENT_PARTICIPANTS SET STATUS = 'ELIGIBLE' WHERE ELECTION_ID = :1 AND PID = :2", (election_id, pid))
        
        # 4. Insert Human-Readable Audit Log
        cursor.execute("INSERT INTO AUDIT_LOGS (PID, ACTION_TYPE, DETAILS, ACTION_TIME) VALUES (:1, 'VOTER_APPROVED', :2, SYSTIMESTAMP)", 
                       (session.get("pid"), f"Approved voter {voter_name} for election '{election_title}'"))

        conn.commit(); return jsonify({"message": "Voter successfully whitelisted!"}), 200
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/status", methods=["PUT"])
def update_election_status(election_id):
    new_status = request_json().get("status", "").strip().upper()
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec or elec[0] != session.get("pid"): return jsonify({"error": "Unauthorized."}), 403

        cursor.execute("UPDATE ELECTION SET STATUS = :1 WHERE ELECTION_ID = :2", (new_status, election_id))
        
        cursor.execute("INSERT INTO AUDIT_LOGS (PID, ACTION_TYPE, DETAILS, ACTION_TIME) VALUES (:1, 'PHASE_UPDATED', :2, SYSTIMESTAMP)", 
                       (session.get("pid"), f"Election {election_id} phase changed to {new_status}"))
        
        conn.commit(); return jsonify({"message": f"Phase updated to {new_status}!"}), 200
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/pending-parties", methods=["GET"])
def get_pending_parties(election_id):
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec or elec[0] != session.get("pid"): 
            return jsonify({"error": "Forbidden."}), 403
        
        cursor.execute("""
            SELECT EP.ELECTION_PARTY_ID, O.ORG_NAME, U.FIRST_NAME || ' ' || U.LAST_NAME
            FROM ELECTION_PARTY EP JOIN ORGANIZATION O ON EP.ORGID = O.ORGID JOIN UACCOUNT U ON EP.LEADER_PID = U.PID
            WHERE EP.ELECTION_ID = :1 AND EP.STATUS = 'PENDING'
        """, (election_id,))
        parties = [{"party_id": r[0], "party_name": r[1], "leader_name": r[2]} for r in cursor.fetchall()]
        return jsonify({"pending_parties": parties}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/parties/<int:party_id>/approve", methods=["POST"])
def approve_election_party(party_id):
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT ELECTION_ID, LEADER_PID FROM ELECTION_PARTY WHERE ELECTION_PARTY_ID = :1", (party_id,))
        party = cursor.fetchone()
        if not party: return jsonify({"error": "Party not found."}), 404
        
        cursor.execute("SELECT ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (party[0],))
        if cursor.fetchone()[0] != session.get("pid"): return jsonify({"error": "Forbidden."}), 403
        
        cursor.execute("UPDATE ELECTION_PARTY SET STATUS = 'APPROVED', REVIEWED_AT = SYSTIMESTAMP, REVIEWED_BY = :1 WHERE ELECTION_PARTY_ID = :2", (session.get("pid"), party_id))
        cursor.execute("INSERT INTO ELECTION_PARTY_MEMBER (ELECTION_PARTY_ID, ELECTION_ID, PID, MEMBER_ROLE, STATUS) VALUES (:1, :2, :3, 'PARTY_LEADER', 'APPROVED')", (party_id, party[0], party[1]))
        
        cursor.execute("INSERT INTO AUDIT_LOGS (PID, ACTION_TYPE, DETAILS, ACTION_TIME) VALUES (:1, 'PARTY_APPROVED', :2, SYSTIMESTAMP)", 
                       (session.get("pid"), f"Approved Party ID {party_id} for Election {party[0]}"))

        conn.commit(); return jsonify({"message": "Party approved for the election!"}), 200
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/pending-candidates", methods=["GET"])
def get_pending_candidates(election_id):
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec or elec[0] != session.get("pid"): 
            return jsonify({"error": "Forbidden."}), 403
        
        cursor.execute("""
            SELECT C.CANDIDATE_ID, U.FIRST_NAME || ' ' || U.LAST_NAME, POS.TITLE, C.MANIFESTO, O.ORG_NAME
            FROM CANDIDATE C JOIN UACCOUNT U ON C.PID = U.PID JOIN ELECTION_POSITION POS ON C.POSITION_ID = POS.POSITION_ID
            JOIN ELECTION_PARTY EP ON C.ELECTION_PARTY_ID = EP.ELECTION_PARTY_ID JOIN ORGANIZATION O ON EP.ORGID = O.ORGID
            WHERE C.ELECTION_ID = :1 AND C.STATUS = 'PENDING'
        """, (election_id,))
        candidates = [{"candidate_id": r[0], "name": f"{r[1]} ({r[4]})", "position": r[2], "manifesto": r[3]} for r in cursor.fetchall()]
        return jsonify({"pending_candidates": candidates}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/candidates/<int:candidate_id>/approve", methods=["POST"])
def approve_candidate(candidate_id):
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT ELECTION_ID FROM CANDIDATE WHERE CANDIDATE_ID = :1", (candidate_id,))
        cand = cursor.fetchone()
        if not cand: return jsonify({"error": "Candidate not found."}), 404
        
        cursor.execute("SELECT ORGANIZER_PID FROM ELECTION WHERE ELECTION_ID = :1", (cand[0],))
        if cursor.fetchone()[0] != session.get("pid"): return jsonify({"error": "Forbidden."}), 403
        
        cursor.execute("UPDATE CANDIDATE SET STATUS = 'ACTIVE', ORGANIZER_APPROVED_AT = SYSTIMESTAMP, ORGANIZER_APPROVED_BY = :1 WHERE CANDIDATE_ID = :2", (session.get("pid"), candidate_id))
        
        cursor.execute("INSERT INTO AUDIT_LOGS (PID, ACTION_TYPE, DETAILS, ACTION_TIME) VALUES (:1, 'TICKET_APPROVED', :2, SYSTIMESTAMP)", 
                       (session.get("pid"), f"Validated Ticket ID {candidate_id} for Election {cand[0]}"))

        conn.commit(); return jsonify({"message": "Ticket validated and added to official ballot!"}), 200
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/audit-logs", methods=["GET"])
def get_audit_logs():
    if not (session.get("is_super_admin") or session.get("is_organizer")): return jsonify({"error": "Unauthorized"}), 403
    conn = get_connection(); cursor = conn.cursor()
    try:
        if session.get("is_super_admin"):
            cursor.execute("SELECT A.LOG_ID, U.FIRST_NAME, A.ACTION_TYPE, A.DETAILS, TO_CHAR(A.ACTION_TIME, 'YYYY-MM-DD HH24:MI:SS') FROM AUDIT_LOGS A JOIN UACCOUNT U ON A.PID = U.PID ORDER BY A.LOG_ID DESC")
        else:
            cursor.execute("SELECT A.LOG_ID, U.FIRST_NAME, A.ACTION_TYPE, A.DETAILS, TO_CHAR(A.ACTION_TIME, 'YYYY-MM-DD HH24:MI:SS') FROM AUDIT_LOGS A JOIN UACCOUNT U ON A.PID = U.PID WHERE A.PID = :1 ORDER BY A.LOG_ID DESC", (session.get("pid"),))
        logs = [{"log_id": r[0], "user_name": r[1], "action_type": r[2], "details": r[3], "action_time": r[4]} for r in cursor.fetchall()]
        return jsonify({"audit_logs": logs}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/fraud-logs", methods=["GET"])
def get_fraud_logs():
    if not (session.get("is_super_admin") or session.get("is_organizer")): return jsonify({"error": "Unauthorized"}), 403
    conn = get_connection(); cursor = conn.cursor()
    try:
        if session.get("is_super_admin"):
            cursor.execute("""
                SELECT F.FRAUD_ID, U.FIRST_NAME || ' ' || U.LAST_NAME, F.FRAUD_TYPE, F.DESCRIPTION, TO_CHAR(F.DETECTED_AT, 'YYYY-MM-DD HH24:MI:SS') 
                FROM FRAUD_LOGS F 
                JOIN UACCOUNT U ON F.PID = U.PID 
                ORDER BY F.FRAUD_ID DESC
            """)
        else:
            cursor.execute("""
                SELECT F.FRAUD_ID, U.FIRST_NAME || ' ' || U.LAST_NAME, F.FRAUD_TYPE, F.DESCRIPTION, TO_CHAR(F.DETECTED_AT, 'YYYY-MM-DD HH24:MI:SS') 
                FROM FRAUD_LOGS F 
                JOIN UACCOUNT U ON F.PID = U.PID 
                WHERE F.PID IN (
                    SELECT PID FROM EVENT_PARTICIPANTS WHERE ELECTION_ID IN (
                        SELECT ELECTION_ID FROM ELECTION WHERE ORGANIZER_PID = :1
                    )
                )
                ORDER BY F.FRAUD_ID DESC
            """, (session.get("pid"),))
        logs = [{"fraud_id": r[0], "user_name": r[1], "fraud_type": r[2], "description": r[3], "detected_at": r[4]} for r in cursor.fetchall()]
        return jsonify({"fraud_logs": logs}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

if __name__ == "__main__":
    print("\n--------------------------------------------")
    print("VoteCore V2 API RUNNING")
    print("--------------------------------------------\n")
    app.run(host="127.0.0.1", port=int(os.getenv("VOTECORE_PORT", "5000")), debug=os.getenv("FLASK_DEBUG") == "1")