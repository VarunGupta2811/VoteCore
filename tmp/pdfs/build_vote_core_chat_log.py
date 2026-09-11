from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether,
)

OUTPUT = r"D:\backup\Users\ASHISH\OneDrive\Desktop\OnlineVotingSystem\output\pdf\VoteCore_Todays_Development_Log.pdf"

NAVY = colors.HexColor("#0B1B33")
BLUE = colors.HexColor("#2657A6")
GOLD = colors.HexColor("#C79A3D")
PAPER = colors.HexColor("#F5F7FB")
MUTED = colors.HexColor("#5B6478")
GREEN = colors.HexColor("#0B7A5F")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="TitleLedger", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=24, leading=29, textColor=NAVY, alignment=TA_CENTER, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="SubtitleLedger", parent=styles["Normal"], fontName="Helvetica",
    fontSize=10, leading=14, textColor=MUTED, alignment=TA_CENTER, spaceAfter=22,
))
styles.add(ParagraphStyle(
    name="SectionLedger", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=14, leading=18, textColor=NAVY, spaceBefore=14, spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="BodyLedger", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.5, leading=14, textColor=NAVY, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="SmallLedger", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8.5, leading=12, textColor=MUTED, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="CalloutLedger", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=10, leading=14, textColor=NAVY, spaceAfter=2,
))


def bullet(text):
    return Paragraph("- " + text, styles["BodyLedger"])


def section(title, items):
    flow = [Paragraph(title, styles["SectionLedger"])]
    flow.extend(bullet(item) for item in items)
    return KeepTogether(flow)


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 0.35 * inch, width, 0.35 * inch, stroke=0, fill=1)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(0.55 * inch, height - 0.23 * inch, "VOTECORE  |  DEVELOPMENT LOG")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(width - 0.55 * inch, 0.35 * inch, f"Page {doc.page}")
    canvas.restoreState()


story = []
story.append(Spacer(1, 0.25 * inch))
story.append(Paragraph("VoteCore", styles["TitleLedger"]))
story.append(Paragraph("Today's development chat - project change log", styles["SubtitleLedger"]))

summary_data = [
    [Paragraph("Work area", styles["SmallLedger"]), Paragraph("Outcome", styles["SmallLedger"])],
    [Paragraph("Visual interface", styles["BodyLedger"]), Paragraph("Civic Ledger design, contrast and fraud-log readability improvements", styles["BodyLedger"])],
    [Paragraph("Backend security", styles["BodyLedger"]), Paragraph("Session validation, CSRF protection, rate limits, OTP controls, access scoping", styles["BodyLedger"])],
    [Paragraph("Local operation", styles["BodyLedger"]), Paragraph("VS Code frontend/backend launch guidance, CORS and cached-script troubleshooting", styles["BodyLedger"])],
    [Paragraph("Election data model", styles["BodyLedger"]), Paragraph("Organizer, party, position, per-post voting and audit-oriented schema planning", styles["BodyLedger"])],
]
summary_table = Table(summary_data, colWidths=[1.55 * inch, 4.95 * inch], repeatRows=1)
summary_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D7DDE8")),
    ("BACKGROUND", (0, 1), (-1, -1), PAPER),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.append(summary_table)
story.append(Spacer(1, 0.16 * inch))
story.append(Paragraph("Scope", styles["SectionLedger"]))
story.append(Paragraph(
    "This document summarizes the work, decisions, troubleshooting, and database migration progress from today's VoteCore conversation. It is a project record, not a replacement for source control or a production deployment checklist.",
    styles["BodyLedger"],
))

story.append(section("1. User interface and accessibility work", [
    "Refreshed the interface around a navy, paper, gold and civic-blue visual system.",
    "Corrected low-contrast text, including the Global Super Admin banner and fraud-log rows.",
    "Added dedicated fraud-log row styling so every log entry remains readable rather than only the highlighted alert.",
    "Improved profile layout behavior and restored a visible organization empty state: 'You have not joined any organizations yet.'",
    "Added a clear profile error state when the backend cannot be reached.",
]))

story.append(section("2. Authentication, sessions and security work", [
    "Required the Flask secret key from environment configuration and hardened session-cookie defaults.",
    "Replaced predictable OTP generation with secrets-based random generation and limited OTP attempts.",
    "Added login attempt throttling and active-account validation.",
    "Added database-backed session validation and current-device / all-device logout support.",
    "Added CSRF token issuance after OTP verification, automatic frontend attachment for authenticated writes, and later corrected CORS preflight handling.",
    "Added profile read/update endpoints and access checks around organization and election actions.",
]))

story.append(PageBreak())
story.append(section("3. Local runtime and email delivery troubleshooting", [
    "Diagnosed that a Python runtime without Flask could not start the backend; the project virtual environment was verified as the correct runtime.",
    "Created a backend launcher and later restored the normal VS Code arrangement: frontend on port 5501 and backend on port 5000.",
    "Diagnosed stale browser JavaScript caused by temporary port changes; cache-busted script references so pages load current frontend code.",
    "Added clear user-facing messages when the backend is unavailable instead of silently redirecting or leaving empty sections.",
    "Validated SMTP configuration and Gmail App Password authentication. SMTP delivery was given a longer timeout and one retry for transient connection closures.",
    "Clarified that the backend terminal must remain running when using the project locally through VS Code.",
]))

story.append(section("4. Election-system design decisions", [
    "Defined a hierarchy: Super Admin, Election Organizer, Party Leader, Candidate and Voter.",
    "Defined the strict neutrality rule: an Organizer cannot contest, create a party, or join a party in their assigned election.",
    "Defined an election lifecycle: organizer appointment, party formation, slate/ticket allocation, scrutiny/voting, and results declaration.",
    "Identified ballot secrecy as a core requirement: voter identity must be separated from the anonymous ballot record.",
    "Recommended post-by-post voting, explicit deadlines, voter-roll freeze, complaints/appeals, observer access, recount handling and provisional results.",
]))

story.append(section("5. Database-schema migration work", [
    "Reviewed the existing Oracle 21c XE schema and identified that it supported basic elections but not election-specific parties, organizer appointments, posts, or per-post anonymous voting.",
    "Outlined new structures: PLATFORM_ROLE, PLATFORM_USER_ROLE, ORGANIZER_APPLICATION, ELECTION_POSITION, ELECTION_PARTY, PARTY_JOIN_REQUEST, ELECTION_PARTY_MEMBER, VOTER_POST_STATUS, ELECTION_PHASE_HISTORY, ELECTION_COMPLAINT, ELECTION_RESULT_DECLARATION and ELECTION_RECOUNT.",
    "Added election-scoped organizer, voter-roll-lock, result-status, candidate-party and candidate-position fields conceptually to the migration plan.",
    "Explained that final NOT NULL constraints must wait until old candidate data is migrated and Flask code creates party-linked candidates correctly.",
]))

story.append(Paragraph("Confirmed Oracle migration progress", styles["SectionLedger"]))
progress_data = [
    ["Item", "Status recorded today"],
    ["Pre-checks", "No duplicate emails found; existing statuses reviewed."],
    ["Organizer", "Aditya (PID 2) appointed as Organizer for Election 1."],
    ["Positions", "President and Vice President records exist for Election 1; existing candidates were mapped to position IDs."],
    ["Neutrality", "Aditya's active President candidacy was withdrawn and retained with timestamp/reason for audit."],
    ["Deferred hardening", "Final NOT NULL constraints and final party-position uniqueness remain intentionally deferred."],
]
progress_table = Table([[Paragraph(c, styles["SmallLedger"]) for c in row] for row in progress_data], colWidths=[1.55 * inch, 4.95 * inch], repeatRows=1)
progress_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D7DDE8")),
    ("BACKGROUND", (0, 1), (-1, -1), PAPER),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.append(progress_table)

story.append(PageBreak())
story.append(section("6. Important lessons from the Oracle SQL session", [
    "SQL*Plus does not automatically understand placeholders such as :election_id. Replace them with real values, or explicitly declare bind variables first.",
    "Do not paste Markdown separators or explanatory lines into SQL*Plus. They are treated as commands and can cause SP2 errors.",
    "Enable SET SQLBLANKLINES ON before pasting multiline SQL containing blank lines.",
    "A unique constraint may automatically create its own index; ORA-01408 in this case indicated that a duplicate manual index was unnecessary.",
    "Do not apply NOT NULL constraints while migration rows still contain NULL values. Migrate and validate first.",
]))

story.append(section("7. Recommended next work", [
    "Decide whether to reset the present election/test data or continue migrating it into parties and party tickets.",
    "If resetting, retain only the Super Admin, then have the Super Admin create new elections.",
    "Update the Flask backend and frontend so normal users can apply to become Organizer, while only the Super Admin can appoint one organizer per election.",
    "Implement party registration, Party Leader approval of members, post allocation, Organizer scrutiny, and party-linked candidate creation.",
    "Update voting to use VOTER_POST_STATUS and anonymous VOTE inserts inside one database transaction.",
    "Only after the application code is migrated should the deferred NOT NULL and final uniqueness constraints be enabled.",
]))

story.append(Spacer(1, 0.15 * inch))
callout = Table([[Paragraph(
    "Current implementation note: the database structures can prepare the new election model, but the requested sign-in and organizer-application behavior requires matching Flask and frontend changes.",
    styles["CalloutLedger"],
)]], colWidths=[6.5 * inch])
callout.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF5DD")),
    ("BOX", (0, 0), (-1, -1), 0.8, GOLD),
    ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ("TOPPADDING", (0, 0), (-1, -1), 10),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
]))
story.append(callout)

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    rightMargin=0.55 * inch,
    leftMargin=0.55 * inch,
    topMargin=0.6 * inch,
    bottomMargin=0.58 * inch,
    title="VoteCore Today's Development Log",
    author="VoteCore project collaboration",
)
doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print(OUTPUT)
