from flask import Flask, request, jsonify, session
from flask_cors import CORS
import oracledb
import bcrypt
import os
import uuid
import random
import smtplib
from email.mime.text import MIMEText
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()
app = Flask(__name__)

# ============================================================
# FLASK & DB CONFIGURATION
# ============================================================
app.secret_key = os.getenv("FLASK_SECRET_KEY", "online-voting-system-secret-key-2026")
CORS(app, supports_credentials=True, origins=["http://127.0.0.1:5500", "http://localhost:5500", "http://127.0.0.1:5501", "http://localhost:5501"])

DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_DSN = os.getenv("DB_DSN")

def get_connection(): return oracledb.connect(user=DB_USER, password=DB_PASSWORD, dsn=DB_DSN)

def send_otp_email(receiver_email, otp_code, user_name):
    sender_email = os.getenv("SMTP_EMAIL")
    sender_password = os.getenv("SMTP_PASSWORD")
    if not sender_email or not sender_password:
        print(f"\n📧 EMAIL BYPASS\nTo: {receiver_email}\nOTP CODE: {otp_code}\n")
        return True
    try:
        msg = MIMEText(f"Hello {user_name},\n\nYour VoteCore login OTP is: {otp_code}\n\nIt expires in 10 minutes.")
        msg['Subject'] = 'VoteCore - Login OTP Verification'; msg['From'] = sender_email; msg['To'] = receiver_email
        server = smtplib.SMTP(os.getenv("SMTP_SERVER", "smtp.gmail.com"), int(os.getenv("SMTP_PORT", 587)))
        server.starttls(); server.login(sender_email, sender_password); server.sendmail(sender_email, [receiver_email], msg.as_string()); server.quit()
        return True
    except Exception as e:
        print("EMAIL SENDING FAILED:", e)
        print(f"OTP CODE FALLBACK: {otp_code}")
        return False

# ============================================================
# AUTHENTICATION & PROFILE
# ============================================================
@app.route("/api/auth/register", methods=["POST"])
def register():
    conn = None; cursor = None
    try:
        data = request.get_json(silent=True)
        first_name, last_name, mobile, email, password = data.get("first_name"), data.get("last_name"), data.get("mobile"), data.get("email"), data.get("password")
        dob_str, aadhaar, voter_id = data.get("dob"), data.get("aadhaar"), data.get("voter_id")

        dob_obj = datetime.strptime(dob_str, "%Y-%m-%d")
        age = datetime.today().year - dob_obj.year - ((datetime.today().month, datetime.today().day) < (dob_obj.month, dob_obj.day))
        if age < 18: return jsonify({"error": f"Registration denied. Must be 18+."}), 403

        conn = get_connection(); cursor = conn.cursor()
        hashed_pw = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        
        pid_var = cursor.var(oracledb.NUMBER)
        cursor.execute("INSERT INTO UACCOUNT (FIRST_NAME, LAST_NAME, MOBILE, EMAIL, PASSWORD_HASH, IS_ACTIVE) VALUES (:1, :2, :3, :4, :5, 1) RETURNING PID INTO :6", 
                       (first_name.strip(), last_name.strip(), mobile.strip(), email.strip(), hashed_pw, pid_var))
        new_pid = pid_var.getvalue()[0]
        
        cursor.execute("INSERT INTO GOV_IDENTITY (PID, EPIC_ID, AADHAAR_NO, FULL_NAME, DOB, IS_VERIFIED) VALUES (:1, :2, :3, :4, TO_DATE(:5, 'YYYY-MM-DD'), 1)", 
                       (new_pid, voter_id.strip().upper(), aadhaar.strip(), f"{first_name} {last_name}", dob_str))
        cursor.execute("INSERT INTO IDENTITY_WALLET (PID, IDENTITY_TYPE, EPIC_ID) VALUES (:1, 'GOV', :2)", (new_pid, voter_id.strip().upper()))
        conn.commit()
        return jsonify({"message": "Registration successful"}), 201
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route("/api/auth/login", methods=["POST"])
def login():
    try:
        data = request.get_json(silent=True)
        email, password = data.get("email", "").strip(), data.get("password", "")
        conn = get_connection(); cursor = conn.cursor()
        cursor.execute("SELECT PID, FIRST_NAME, PASSWORD_HASH, IS_ACTIVE FROM UACCOUNT WHERE LOWER(EMAIL) = LOWER(:1)", (email,))
        row = cursor.fetchone()
        
        if not row or not bcrypt.checkpw(password.encode("utf-8"), row[2].encode("utf-8")): return jsonify({"error": "Invalid credentials"}), 401
        
        otp_code = str(random.randint(100000, 999999))
        cursor.execute("INSERT INTO OTP_VERIFICATION (PID, OTP_CODE, EXPIRES_AT) VALUES (:1, :2, SYSTIMESTAMP + INTERVAL '10' MINUTE)", (row[0], otp_code))
        conn.commit(); cursor.close(); conn.close()
        send_otp_email(email, otp_code, row[1])
        session["temp_pid"] = row[0]
        return jsonify({"requires_otp": True}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/auth/verify-otp", methods=["POST"])
def verify_otp():
    try:
        user_otp = request.get_json(silent=True).get("otp", "").strip()
        pid = session.get("temp_pid")
        if not pid: return jsonify({"error": "Session expired."}), 401
        
        conn = get_connection(); cursor = conn.cursor()
        cursor.execute("SELECT OTP_ID, OTP_CODE FROM OTP_VERIFICATION WHERE PID = :1 AND VERIFIED = 0 AND SYSTIMESTAMP <= EXPIRES_AT ORDER BY CREATED_AT DESC FETCH FIRST 1 ROWS ONLY", (pid,))
        row = cursor.fetchone()
        if not row or row[1] != user_otp: return jsonify({"error": "Invalid or expired OTP."}), 401
        
        cursor.execute("UPDATE OTP_VERIFICATION SET VERIFIED = 1 WHERE OTP_ID = :1", (row[0],))
        cursor.execute("SELECT FIRST_NAME, LAST_NAME, EMAIL FROM UACCOUNT WHERE PID = :1", (pid,))
        user_row = cursor.fetchone()
        
        # STRICT ROLE SEGREGATION
        is_super_admin = (user_row[2].lower() == 'varun.vip2811@gmail.com')
        cursor.execute("SELECT COUNT(*) FROM MEMBER_ROLES M JOIN ROLE R ON M.ROLE_ID = R.ROLE_ID WHERE M.PID = :1 AND UPPER(R.ROLE_NAME) IN ('ORGANIZER', 'ADMIN')", (pid,))
        is_organizer = cursor.fetchone()[0] > 0
        
        db_session_id = str(uuid.uuid4())
        cursor.execute("INSERT INTO USER_SESSIONS (SESSION_ID, PID, EXPIRES_AT, IS_ACTIVE) VALUES (:1, :2, SYSTIMESTAMP + INTERVAL '1' DAY, 1)", (db_session_id, pid))
        conn.commit(); cursor.close(); conn.close()

        session.clear()
        session.update({"logged_in": True, "pid": int(pid), "email": user_row[2], "first_name": user_row[0], "last_name": user_row[1], "is_organizer": is_organizer, "is_super_admin": is_super_admin, "db_session_id": db_session_id})
        return jsonify({"message": "Login successful", "user": {"pid": int(pid), "is_organizer": is_organizer, "is_super_admin": is_super_admin}}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/auth/me", methods=["GET"])
def get_current_user():
    if not session.get("logged_in"): return jsonify({"logged_in": False}), 401
    return jsonify({"logged_in": True, "user": {"pid": session.get("pid"), "is_organizer": session.get("is_organizer", False), "is_super_admin": session.get("is_super_admin", False)}}), 200

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logout successful"}), 200

@app.route("/api/auth/profile", methods=["GET"])
def get_profile():
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    conn = get_connection(); cursor = conn.cursor()
    cursor.execute("""
        SELECT U.FIRST_NAME, U.LAST_NAME, U.MOBILE, U.EMAIL, U.COUNTRY, U.STATE, G.EPIC_ID, G.AADHAAR_NO, G.IS_VERIFIED
        FROM UACCOUNT U LEFT JOIN GOV_IDENTITY G ON U.PID = G.PID WHERE U.PID = :1
    """, (session.get("pid"),))
    row = cursor.fetchone()
    cursor.execute("SELECT O.ORG_NAME, R.ROLE_NAME FROM ORG_MEMBERS OM JOIN ORGANIZATION O ON OM.ORGID = O.ORGID LEFT JOIN MEMBER_ROLES MR ON OM.ORGID = MR.ORGID AND OM.PID = MR.PID LEFT JOIN ROLE R ON MR.ROLE_ID = R.ROLE_ID WHERE OM.PID = :1", (session.get("pid"),))
    orgs = [{"org_name": r[0], "role": r[1] or "Member"} for r in cursor.fetchall()]
    cursor.close(); conn.close()
    
    return jsonify({"profile": {
        "mobile": row[2], "email": row[3], "country": row[4], "state": row[5],
        "voter_id": row[6] or "Not Linked", "aadhaar": "XXXX-XXXX-" + str(row[7])[-4:] if row[7] else "Not Linked",
        "is_verified": bool(row[8]), "organizations": orgs
    }}), 200

# ============================================================
# ELECTIONS & VOTING
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
    # SCRUTINY: Voters only see ACTIVE candidates on the ballot
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
    candidate_id = request.get_json(silent=True).get("candidate_id")
    pid = session.get("pid")
    
    conn = get_connection(); cursor = conn.cursor()
    try:
        # Check Election Phase
        cursor.execute("SELECT STATUS FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        elec = cursor.fetchone()
        if not elec or elec[0] != "ACTIVE": return jsonify({"error": "Voting is closed. This election is not in the ACTIVE phase."}), 400

        cursor.execute("SELECT COUNT(*) FROM EVENT_PARTICIPANTS WHERE ELECTION_ID = :1 AND PID = :2", (election_id, pid))
        if cursor.fetchone()[0] == 0: cursor.execute("INSERT INTO EVENT_PARTICIPANTS (ELECTION_ID, PID, STATUS) VALUES (:1, :2, 'ELIGIBLE')", (election_id, pid))
        
        cursor.execute("INSERT INTO VOTE (ELECTION_ID, PID, CANDIDATE_ID, VOTED_AT) VALUES (:1, :2, :3, SYSTIMESTAMP)", (election_id, pid, candidate_id))
        conn.commit()
        return jsonify({"message": "Vote cast successfully"}), 200
    except oracledb.IntegrityError:
        if conn: conn.rollback()
        return jsonify({"error": "You have already voted in this election!"}), 409
    finally:
        cursor.close(); conn.close()

@app.route("/api/elections/<int:election_id>/self-nominate", methods=["POST"])
def self_nominate(election_id):
    if not session.get("logged_in"): return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True)
    position, manifesto, pid = data.get("position", "").strip(), data.get("manifesto", "").strip(), session.get("pid")

    conn = get_connection(); cursor = conn.cursor()
    try:
        # Check Election Phase
        cursor.execute("SELECT STATUS FROM ELECTION WHERE ELECTION_ID = :1", (election_id,))
        if cursor.fetchone()[0] != 'NOMINATION': return jsonify({"error": "This election is not currently accepting nominations."}), 400

        # Insert as PENDING
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
    cursor.execute("""
        SELECT C.CANDIDATE_ID, U.FIRST_NAME || ' ' || U.LAST_NAME, C.POSITION, NVL(VR.VOTE_COUNT, 0)
        FROM CANDIDATE C JOIN UACCOUNT U ON C.PID = U.PID LEFT JOIN VOTE_RESULTS VR ON C.CANDIDATE_ID = VR.CANDIDATE_ID AND C.ELECTION_ID = VR.ELECTION_ID
        WHERE C.ELECTION_ID = :1 ORDER BY NVL(VR.VOTE_COUNT, 0) DESC
    """, (election_id,))
    results = [{"candidate_name": r[1], "position": r[2], "total_votes": int(r[3])} for r in cursor.fetchall()]
    cursor.close(); conn.close()
    return jsonify({"results": results}), 200

# ============================================================
# ORGANIZER CONTROLS (ELECTION & CANDIDATE SCRUTINY)
# ============================================================
@app.route("/api/admin/elections", methods=["POST"])
def create_election():
    if not session.get("is_organizer"): return jsonify({"error": "Unauthorized"}), 403
    data = request.get_json(silent=True)
    conn = get_connection(); cursor = conn.cursor()
    try:
        # New elections start as UPCOMING
        cursor.execute("INSERT INTO ELECTION (ORGID, TITLE, DESCRIPTION, START_DATE, STATUS) VALUES (:1, :2, :3, SYSTIMESTAMP, 'UPCOMING')", 
                       (data.get("orgid").strip(), data.get("title").strip(), data.get("description").strip()))
        conn.commit(); return jsonify({"message": "Election created as UPCOMING phase."}), 201
    except Exception as e:
        if conn: conn.rollback(); return jsonify({"error": str(e)}), 500
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/status", methods=["PUT"])
def update_election_status(election_id):
    if not session.get("is_organizer"): return jsonify({"error": "Unauthorized"}), 403
    new_status = request.get_json(silent=True).get("status", "").strip().upper()
    if new_status not in ["UPCOMING", "NOMINATION", "ACTIVE", "COMPLETED"]: return jsonify({"error": "Invalid status."}), 400

    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("UPDATE ELECTION SET STATUS = :1 WHERE ELECTION_ID = :2", (new_status, election_id))
        conn.commit(); return jsonify({"message": f"Election phase updated to {new_status}!"}), 200
    finally:
        cursor.close(); conn.close()

@app.route("/api/admin/elections/<int:election_id>/pending-candidates", methods=["GET"])
def get_pending_candidates(election_id):
    if not session.get("is_organizer"): return jsonify({"error": "Unauthorized"}), 403
    conn = get_connection(); cursor = conn.cursor()
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
    data = request.get_json(silent=True)
    orgid, org_name, org_email, pid = data.get("orgid").strip().upper(), data.get("org_name").strip(), data.get("org_email").strip(), session.get("pid")
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO ORGANIZATION (ORGID, ORG_NAME, ORG_EMAIL, IS_ACTIVE) VALUES (:1, :2, :3, 0)", (orgid, org_name, org_email))
        cursor.execute("INSERT INTO ORG_MEMBERS (ORGID, PID, MEMBER_STATUS) VALUES (:1, :2, 'ACTIVE')", (orgid, pid))
        cursor.execute("SELECT ROLE_ID FROM ROLE WHERE ROLE_NAME = 'ADMIN'")
        cursor.execute("INSERT INTO MEMBER_ROLES (ORGID, PID, ROLE_ID) VALUES (:1, :2, :3)", (orgid, pid, cursor.fetchone()[0]))
        conn.commit(); return jsonify({"message": "Organization requested! Pending Super Admin approval."}), 201
    except oracledb.IntegrityError:
        if conn: conn.rollback(); return jsonify({"error": "This Organization ID is already taken."}), 409
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
    print("Port: 5000")
    print("--------------------------------------------\n")
    app.run(host="127.0.0.1", port=5000, debug=True)