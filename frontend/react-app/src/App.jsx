import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion
} from "framer-motion";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams
} from "react-router-dom";
import { api, clearUser, downloadFile, saveUser } from "./api.js";

const SessionContext = createContext(null);
const transition = { duration: 0.5, ease: [0.22, 1, 0.36, 1] };

function useSession() {
  return useContext(SessionContext);
}

function usePageData(loader, dependencies = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);

  const refresh = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true);
    setError("");
    try {
      const result = await loader();
      setData(result);
      return result;
    } catch (err) {
      setError(err.message || "Could not load this page.");
      return null;
    } finally {
      setLoading(false);
      hasLoaded.current = true;
    }
  // The caller supplies stable IDs; loader closures are intentionally recreated per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    hasLoaded.current = false;
    setData(null);
    setError("");
    setLoading(true);
    refresh();
  }, [refresh]);
  return { data, error, loading, refresh, setData };
}

function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api("/api/auth/me");
      saveUser(data.user, data.csrf_token);
      setUser(data.user);
      return data.user;
    } catch {
      clearUser();
      setUser(null);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  const sessionValue = useMemo(() => ({ user, setUser, ready, refreshUser }), [user, ready, refreshUser]);
  const location = useLocation();

  return (
    <MotionConfig reducedMotion="user" transition={transition}>
      <SessionContext.Provider value={sessionValue}>
        <div className="app-backdrop" aria-hidden="true">
          <div className="backdrop-orb backdrop-orb-one" />
          <div className="backdrop-orb backdrop-orb-two" />
          <div className="backdrop-grid" />
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            className="route-frame"
            initial={{ opacity: 0, y: 12, filter: "blur(5px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            transition={transition}
          >
            <Routes location={location}>
              <Route path="/" element={<AuthPage />} />
              <Route path="/index.html" element={<Navigate to="/" replace />} />
              <Route path="/register" element={<AuthPage initialMode="register" />} />
              <Route path="/register.html" element={<Navigate to="/register" replace />} />
              <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />
              <Route path="/election" element={<Guard><ElectionPage /></Guard>} />
              <Route path="/results" element={<Guard><ResultsPage /></Guard>} />
              <Route path="/profile" element={<Guard><ProfilePage /></Guard>} />
              <Route path="/admin" element={<Guard roles={["is_organizer", "is_super_admin"]}><AdminPage /></Guard>} />
              <Route path="/dashboard.html" element={<Navigate to="/dashboard" replace />} />
              <Route path="/election.html" element={<Guard><ElectionPage /></Guard>} />
              <Route path="/results.html" element={<Guard><ResultsPage /></Guard>} />
              <Route path="/profile.html" element={<Guard><ProfilePage /></Guard>} />
              <Route path="/admin.html" element={<Guard roles={["is_organizer", "is_super_admin"]}><AdminPage /></Guard>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </SessionContext.Provider>
    </MotionConfig>
  );
}

function Guard({ children, roles }) {
  const { user, ready } = useSession();
  if (!ready) return <LoadingScreen label="Restoring your secure session" />;
  if (!user) return <Navigate to="/" replace />;
  if (roles && !roles.some((role) => user[role])) return <Navigate to="/dashboard" replace />;
  return children;
}

function LoadingScreen({ label = "Loading VoteCore" }) {
  return <main className="loading-screen"><span className="loader-seal" /><p>{label}</p></main>;
}

function Brand({ compact = false }) {
  return <Link className={`brand-mark ${compact ? "brand-compact" : ""}`} to="/dashboard" aria-label="VoteCore dashboard">
    <span className="brand-icon" aria-hidden="true">V</span>
    <span>VOTE<span className="brand-light">CORE</span></span>
  </Link>;
}

function AppHeader({ eyebrow, title }) {
  const { user, setUser } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (error) {
      window.alert(error.message);
    } finally {
      clearUser();
      setUser(null);
      navigate("/");
      setBusy(false);
    }
  }

  return <header className="topbar">
    <Brand compact />
    <div className="topbar-center">
      {eyebrow && <span className="topbar-eyebrow">{eyebrow}</span>}
      {title && <span className="topbar-title">{title}</span>}
    </div>
    <div className="topbar-actions">
      <Link to="/profile" className="user-chip">
        <span className="avatar">{(user?.first_name || "V").slice(0, 1).toUpperCase()}</span>
        <span>{user?.first_name || "Voter"}</span>
      </Link>
      <button className="icon-button" onClick={logout} disabled={busy} aria-label="Log out" title="Log out">↗</button>
    </div>
  </header>;
}

function PageLayout({ children, eyebrow, title, max = "wide" }) {
  return <div className={`page-layout page-${max}`}>
    <AppHeader eyebrow={eyebrow} title={title} />
    <main className="page-content">{children}</main>
    <footer className="app-footer"><Brand compact /><span>Secure by design. Verifiable by everyone.</span></footer>
  </div>;
}

function SectionHeading({ label, title, description, action }) {
  return <div className="section-heading">
    <div>
      {label && <p className="eyebrow">{label}</p>}
      <h2>{title}</h2>
      {description && <p className="section-description">{description}</p>}
    </div>
    {action}
  </div>;
}

function MotionCard({ children, className = "", delay = 0, ...props }) {
  return <motion.section
    className={`surface-card ${className}`}
    initial={{ opacity: 0, y: 16 }}
    whileInView={{ opacity: 1, y: 0 }}
    whileHover={{ y: -3 }}
    viewport={{ once: true, amount: 0.08 }}
    transition={{ ...transition, delay }}
    {...props}
  >{children}</motion.section>;
}

function Notice({ tone = "info", children }) {
  if (!children) return null;
  return <div className={`notice notice-${tone}`} role="status">{children}</div>;
}

function BallotCelebration() {
  const shouldReduceMotion = useReducedMotion();
  if (shouldReduceMotion) return null;

  const particles = Array.from({ length: 18 }, (_, index) => ({
    id: index,
    left: `${(index * 37 + 8) % 96}%`,
    delay: `${(index % 6) * 55}ms`,
    duration: `${1550 + (index % 4) * 100}ms`,
    drift: `${((index * 29) % 121) - 60}px`,
    rotation: `${index % 2 ? 145 : -145}deg`
  }));

  return <motion.div
    className="ballot-celebration"
    aria-hidden="true"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.2 }}
  >
    {particles.map((particle) => <span
      className="ballot-particle"
      key={particle.id}
      style={{
        left: particle.left,
        animationDelay: particle.delay,
        animationDuration: particle.duration,
        "--ballot-drift": particle.drift,
        "--ballot-rotation": particle.rotation
      }}
    ><i /><i /><i /></span>)}
  </motion.div>;
}

function Field({ label, name, className = "", as: Element = "input", children, ...props }) {
  return <label className={`field ${className}`}>
    <span>{label}</span>
    <Element name={name} {...props}>{Element === "select" ? children : undefined}</Element>
  </label>;
}

function Button({ children, variant = "primary", className = "", ...props }) {
  return <motion.button
    className={`button button-${variant} ${className}`}
    whileHover={{ y: -2, scale: 1.015 }}
    whileTap={{ scale: 0.985 }}
    {...props}
  >{children}</motion.button>;
}

const indianStates = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
  "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
  "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim",
  "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
];

function AuthPage({ initialMode = "login" }) {
  const { user, setUser, ready, refreshUser } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [recoveryStep, setRecoveryStep] = useState(1);

  useEffect(() => {
    if (ready && user) navigate(user.is_super_admin || user.is_organizer ? "/admin" : "/dashboard", { replace: true });
  }, [ready, user, navigate]);

  async function submitLogin(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setNotice(null);
    try {
      const { data } = await api("/api/auth/login", { method: "POST", body: { email: form.email, password: form.password } });
      saveUser(data.user, data.csrf_token);
      setUser(data.user);
      navigate(data.user?.is_super_admin || data.user?.is_organizer ? "/admin" : "/dashboard");
    } catch (error) { setNotice({ tone: "error", text: error.message }); }
    finally { setBusy(false); }
  }

  async function submitRegistration(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    if (form.password !== form.confirm_password) {
      setNotice({ tone: "error", text: "Passwords do not match." });
      return;
    }
    setBusy(true); setNotice(null);
    try {
      const { data } = await api("/api/auth/register", {
        method: "POST",
        body: {
          first_name: form.first_name, last_name: form.last_name, mobile: form.mobile,
          email: form.email, password: form.password, dob: form.dob,
          aadhaar: form.aadhaar, voter_id: form.voter_id,
          country: form.country || "India", state: form.state
        }
      });
      setPendingEmail(data.email);
      setMode("verify");
      setNotice({ tone: "success", text: "We sent a six-digit verification code to your email." });
    } catch (error) { setNotice({ tone: "error", text: error.message }); }
    finally { setBusy(false); }
  }

  async function verifyRegistration(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setNotice(null);
    try {
      await api("/api/auth/register-verify", { method: "POST", body: { email: pendingEmail, otp: form.otp } });
      setMode("login");
      setNotice({ tone: "success", text: "Registration complete. You can now sign in." });
    } catch (error) { setNotice({ tone: "error", text: error.message }); }
    finally { setBusy(false); }
  }

  async function requestRecovery(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setNotice(null);
    try {
      const { data } = await api("/api/auth/forgot-password", { method: "POST", body: { email: form.email } });
      setPendingEmail(data.email || form.email);
      setRecoveryStep(2);
      setNotice({ tone: "success", text: data.message });
    } catch (error) { setNotice({ tone: "error", text: error.message }); }
    finally { setBusy(false); }
  }

  async function resetPassword(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    if (form.new_password !== form.confirm_password) {
      setNotice({ tone: "error", text: "Passwords do not match." });
      return;
    }
    setBusy(true); setNotice(null);
    try {
      const { data } = await api("/api/auth/reset-password", {
        method: "POST",
        body: { email: pendingEmail, otp: form.otp, new_password: form.new_password }
      });
      setMode("login");
      setNotice({ tone: "success", text: data.message });
    } catch (error) { setNotice({ tone: "error", text: error.message }); }
    finally { setBusy(false); }
  }

  if (!ready) return <LoadingScreen label="Preparing your secure ballot" />;

  return <main className="auth-page">
    <nav className="auth-nav">
      <Brand />
      <div className="auth-nav-links">
        <button onClick={() => { setMode("login"); setNotice(null); }}>Sign in</button>
        <button onClick={() => { setMode("register"); setNotice(null); }}>Create account</button>
      </div>
      <span className="secure-label"><i /> Protected session</span>
    </nav>
    <section className="auth-hero">
      <div className="hero-copy">
        <motion.p className="eyebrow" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}>
          <span className="live-dot" /> A better way to choose
        </motion.p>
        <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...transition, delay: 0.08 }}>
          Every voice.<br /><span>Every vote.</span>
        </motion.h1>
        <motion.p className="hero-description" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          Secure, transparent elections for communities that believe every decision deserves trust.
        </motion.p>
        <div className="hero-proof">
          <span><i>01</i> Identity verified</span>
          <span><i>02</i> Ballots protected</span>
          <span><i>03</i> Results verifiable</span>
        </div>
        <motion.div className="ballot-art" aria-hidden="true" animate={{ y: [0, -8, 0], rotate: [0, 1, 0] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}>
          <span className="ballot-line" /><span className="ballot-line short" />
          <span className="ballot-choice"><i /> Candidate A</span>
          <span className="ballot-choice selected"><i>✓</i> Candidate B</span>
          <span className="ballot-seal">VC</span>
        </motion.div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={mode} className="auth-panel-wrap" initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={transition}>
          <AuthPanel
            mode={mode} setMode={setMode} busy={busy} notice={notice}
            onLogin={submitLogin} onRegister={submitRegistration}
            onVerify={verifyRegistration} onRecovery={requestRecovery}
            onReset={resetPassword} recoveryStep={recoveryStep}
            setRecoveryStep={setRecoveryStep} pendingEmail={pendingEmail}
          />
        </motion.div>
      </AnimatePresence>
    </section>
    <footer className="auth-footer"><span>VoteCore</span><span>Private by design · Accountable by default</span></footer>
  </main>;
}

function AuthPanel({ mode, setMode, busy, notice, onLogin, onRegister, onVerify, onRecovery, onReset, recoveryStep, setRecoveryStep, pendingEmail }) {
  if (mode === "register") return <MotionCard className="auth-card">
    <p className="eyebrow">Voter enrollment</p><h2>Create your account</h2>
    <p className="muted">Confirm your identity to participate in verified elections.</p>
    <form onSubmit={onRegister} className="form-stack">
      <div className="form-row">
        <Field label="First name" name="first_name" required autoComplete="given-name" />
        <Field label="Last name" name="last_name" required autoComplete="family-name" />
      </div>
      <Field label="Mobile number" name="mobile" type="tel" maxLength="15" required />
      <Field label="Email address" name="email" type="email" autoComplete="email" required />
      <div className="form-row">
        <Field label="Country" name="country" defaultValue="India" required />
        <Field label="State / UT" name="state" as="select" required defaultValue="">
          <option value="" disabled>Select state</option>
          {indianStates.map((state) => <option key={state}>{state}</option>)}
        </Field>
      </div>
      <Field label="Date of birth" name="dob" type="date" required />
      <div className="form-row">
        <Field label="Government ID number" name="aadhaar" inputMode="numeric" maxLength="12" required />
        <Field label="Voter ID / EPIC" name="voter_id" maxLength="20" required />
      </div>
      <div className="form-row">
        <Field label="Password" name="password" type="password" autoComplete="new-password" required />
        <Field label="Confirm password" name="confirm_password" type="password" autoComplete="new-password" required />
      </div>
      <Notice tone={notice?.tone}>{notice?.text}</Notice>
      <Button disabled={busy}>{busy ? "Sending verification…" : "Continue securely"} <span>↗</span></Button>
    </form>
    <p className="auth-switch">Already enrolled? <button onClick={() => setMode("login")}>Sign in</button></p>
  </MotionCard>;

  if (mode === "verify") return <MotionCard className="auth-card">
    <p className="eyebrow">Email verification</p><h2>Check your inbox</h2>
    <p className="muted">Enter the six-digit code sent to <strong>{pendingEmail}</strong>.</p>
    <form onSubmit={onVerify} className="form-stack">
      <Field label="One-time passcode" name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength="6" required />
      <Notice tone={notice?.tone}>{notice?.text}</Notice>
      <Button disabled={busy}>{busy ? "Verifying…" : "Verify registration"}</Button>
    </form>
    <p className="auth-switch"><button onClick={() => setMode("register")}>Back to registration</button></p>
  </MotionCard>;

  if (mode === "recovery") return <MotionCard className="auth-card">
    <p className="eyebrow">Account recovery</p><h2>Reset your password</h2>
    {recoveryStep === 1
      ? <form onSubmit={onRecovery} className="form-stack">
        <p className="muted">We’ll send a one-time code to your registered email.</p>
        <Field label="Email address" name="email" type="email" autoComplete="email" required />
        <Notice tone={notice?.tone}>{notice?.text}</Notice>
        <Button disabled={busy}>{busy ? "Sending code…" : "Send recovery code"}</Button>
      </form>
      : <form onSubmit={onReset} className="form-stack">
        <p className="muted">Enter the code sent to {pendingEmail} and choose a new password.</p>
        <Field label="One-time passcode" name="otp" inputMode="numeric" maxLength="6" required />
        <Field label="New password" name="new_password" type="password" autoComplete="new-password" required />
        <Field label="Confirm password" name="confirm_password" type="password" autoComplete="new-password" required />
        <Notice tone={notice?.tone}>{notice?.text}</Notice>
        <Button disabled={busy}>{busy ? "Updating…" : "Update password"}</Button>
      </form>}
    <p className="auth-switch">
      <button onClick={() => { setRecoveryStep(1); setMode("login"); }}>Back to sign in</button>
    </p>
  </MotionCard>;

  return <MotionCard className="auth-card">
    <p className="eyebrow">Member access</p><h2>Welcome back</h2>
    <p className="muted">Sign in to explore elections and cast your ballot.</p>
    <form onSubmit={onLogin} className="form-stack">
      <Field label="Email address" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <Notice tone={notice?.tone}>{notice?.text}</Notice>
      <Button disabled={busy}>{busy ? "Authenticating…" : "Secure sign in"} <span>↗</span></Button>
    </form>
    <div className="auth-links">
      <button onClick={() => { setMode("recovery"); setRecoveryStep(1); }}>Forgot password?</button>
      <button onClick={() => setMode("register")}>Create account</button>
    </div>
    <p className="privacy-note"><span className="lock-icon">⌑</span> Your selection stays private. Always.</p>
  </MotionCard>;
}

function Dashboard() {
  const { user } = useSession();
  const [showHostForm, setShowHostForm] = useState(false);
  const [notice, setNotice] = useState("");
  const { data, error, loading, refresh } = usePageData(async () => {
    const { data } = await api("/api/elections");
    return data.elections || [];
  }, []);

  async function submitHosting(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const { data: result } = await api("/api/elections/request-hosting", { method: "POST", body: form });
      setNotice(result.message); setShowHostForm(false);
    } catch (err) { setNotice(err.message); }
  }

  async function archiveElection(electionId) {
    if (!window.confirm("Archive this completed election?")) return;
    try {
      const { data: result } = await api(`/api/admin/elections/${electionId}`, { method: "DELETE" });
      setNotice(result.message); refresh();
    } catch (err) { setNotice(err.message); }
  }

  return <PageLayout eyebrow="Your workspace" title="Elections">
    <section className="dashboard-hero">
      <div>
        <p className="eyebrow">Welcome back, {user?.first_name || "voter"}</p>
        <h1>Make your voice<br /><span>count.</span></h1>
        <p>Explore the elections you can participate in.</p>
      </div>
      <motion.div className="hero-orbit" aria-hidden="true" animate={{ rotate: 360 }} transition={{ duration: 36, repeat: Infinity, ease: "linear" }}>
        <span className="orbit-dot" /><span className="orbit-center">VC</span><span className="orbit-ring" />
      </motion.div>
    </section>
    {user?.is_super_admin && <Link className="role-link" to="/admin">Platform administration <span>↗</span></Link>}
    {user?.is_organizer && <Link className="role-link role-link-violet" to="/admin">Organizer workspace <span>↗</span></Link>}
    {!user?.is_super_admin && <Button variant="secondary" className="host-cta" onClick={() => setShowHostForm((value) => !value)}>
      {showHostForm ? "Close hosting request" : "Request to host an election"} <span>＋</span>
    </Button>}
    <Notice tone={notice ? "success" : "info"}>{notice}</Notice>
    <SectionHeading label="Live civic calendar" title="Available elections" description="Open an election to see the ballot, register, and follow live turnout." />
    {loading ? <LoadingScreen label="Loading elections" /> : error ? <Notice tone="error">{error}</Notice> : (
      <motion.div className="election-list" variants={{ show: { transition: { staggerChildren: 0.08 } } }} initial="hidden" animate="show">
        {(data || []).length === 0 && <MotionCard><p className="empty-state">No elections are available right now.</p></MotionCard>}
        {(data || []).map((election, index) => <motion.article
          key={election.election_id}
          className="election-tile"
          variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition } }}
          whileHover={{ y: -5, rotateX: 1 }}
        >
          <div className="tile-top"><span className="tile-index">{String(index + 1).padStart(2, "0")}</span><StatusPill value={election.status} /></div>
          <div>
            <p className="eyebrow">{election.status === "ACTIVE" ? "Voting is open" : "Official election"}</p>
            <h3>{election.title}</h3>
            <p className="muted">{election.description || "A verified VoteCore election."}</p>
          </div>
          <div className="tile-actions">
            <Link className="button button-primary" to={`/election?id=${election.election_id}`}>View election <span>↗</span></Link>
            {election.status === "COMPLETED" && <Link className="button button-quiet" to={`/results?id=${election.election_id}`}>Results</Link>}
            {user?.is_super_admin && election.status === "COMPLETED" && <button className="button button-danger" onClick={() => archiveElection(election.election_id)}>Archive</button>}
          </div>
        </motion.article>)}
      </motion.div>
    )}
    <AnimatePresence>
      {showHostForm && <Modal title="Host an election" onClose={() => setShowHostForm(false)}>
        <form className="form-stack" onSubmit={submitHosting}>
          <Field label="Organization / institution" name="org_name" required />
          <Field label="Election title" name="title" required />
          <Field label="Purpose and description" name="description" as="textarea" rows="3" />
          <Button>Submit hosting request</Button>
        </form>
      </Modal>}
    </AnimatePresence>
  </PageLayout>;
}

function StatusPill({ value }) {
  return <span className={`status-pill status-${String(value || "").toLowerCase()}`}>{value}</span>;
}

function ElectionPage() {
  const { user } = useSession();
  const [params] = useSearchParams();
  const electionId = params.get("id");
  const [notice, setNotice] = useState(null);
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [receipts, setReceipts] = useState(() => readReceipts(electionId));
  const loadElection = useCallback(async () => {
    if (!electionId) throw new Error("Election ID is missing.");
    const [electionResponse, partiesResponse, candidatesResponse, positionsResponse, turnoutResponse] = await Promise.all([
      api(`/api/elections/${electionId}`), api(`/api/elections/${electionId}/parties`),
      api(`/api/elections/${electionId}/candidates`), api(`/api/elections/${electionId}/positions`),
      api(`/api/elections/${electionId}/turnout`)
    ]);
    return {
      election: electionResponse.data.election,
      parties: partiesResponse.data.parties || [],
      candidates: candidatesResponse.data.candidates || [],
      positions: positionsResponse.data.positions || [],
      turnout: turnoutResponse.data.positions || []
    };
  }, [electionId]);
  const { data, error, loading, refresh } = usePageData(loadElection, [loadElection]);
  const election = data?.election;
  const eligible = election?.voter_status === "ELIGIBLE";
  const inNomination = election?.status === "NOMINATION";
  const isOrganizer = election?.organizer_pid === user?.pid;
  const canParticipate = !user?.is_super_admin && !isOrganizer;
  const isLeader = data?.parties.some((party) => party.leader_pid === user?.pid);
  const [members, setMembers] = useState([]);
  const [verifyMessages, setVerifyMessages] = useState({});
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!celebrationKey) return undefined;
    const timer = window.setTimeout(() => setCelebrationKey(0), 2200);
    return () => window.clearTimeout(timer);
  }, [celebrationKey]);

  useEffect(() => {
    setReceipts(readReceipts(electionId));
    setVerifyMessages({});
  }, [electionId]);

  useEffect(() => {
    if (!electionId) return undefined;
    const timer = window.setInterval(() => refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [electionId, refresh]);

  useEffect(() => {
    if (isLeader && inNomination) {
      api(`/api/elections/${electionId}/my-party-members`)
        .then(({ data: result }) => setMembers(result.members || []))
        .catch((err) => setNotice({ tone: "error", text: err.message }));
    }
  }, [electionId, isLeader, inNomination]);

  async function action(path, options = {}, successMessage) {
    try {
      const { data: result } = await api(path, options);
      setNotice({ tone: "success", text: successMessage || result.message || "Done." });
      await refresh();
      return result;
    } catch (err) { setNotice({ tone: "error", text: err.message }); return null; }
  }

  async function castVote(candidateId) {
    if (!window.confirm("Cast your vote for this candidate? You cannot change it later.")) return;
    const result = await action(`/api/elections/${electionId}/vote`, { method: "POST", body: { candidate_id: candidateId } });
    if (!result?.receipt) return;
    const next = [{ receipt: result.receipt, received_at: new Date().toISOString() }, ...receipts].slice(0, 20);
    localStorage.setItem(`voteReceipts:${electionId}`, JSON.stringify(next));
    setReceipts(next);
    if (!shouldReduceMotion) setCelebrationKey((key) => key + 1);
    setNotice({ tone: "success", text: `${result.message} Save this receipt: ${result.receipt}` });
  }

  async function verifyReceipt(receipt, index) {
    try {
      const { data: result } = await api(`/api/elections/${electionId}/receipt/verify?token=${encodeURIComponent(receipt)}`);
      setVerifyMessages((current) => ({ ...current, [index]: result.valid ? "Verified: ballot recorded, selection remains private." : "Receipt is invalid or ballot was not found." }));
    } catch (err) {
      setVerifyMessages((current) => ({ ...current, [index]: err.message }));
    }
  }

  if (loading) return <LoadingScreen label="Opening official ballot" />;
  if (error || !election) return <PageLayout eyebrow="Official ballot"><Notice tone="error">{error || "Election not found."}</Notice></PageLayout>;

  const groupedCandidates = groupBy(data.candidates, (candidate) => candidate.position);

  return <PageLayout eyebrow={`Official ballot · ${election.status}`} title={election.title}>
    <AnimatePresence>{celebrationKey > 0 && <BallotCelebration key={celebrationKey} />}</AnimatePresence>
    <div className="election-hero">
      <div>
        <p className="eyebrow">A verified VoteCore election</p><h1>{election.title}</h1>
        <p>{election.description || "An accountable election for your community."}</p>
      </div>
      <StatusPill value={election.status} />
    </div>
    <Notice tone={notice?.tone}>{notice?.text}</Notice>
    {canParticipate && !election.voter_status && !["COMPLETED", "ARCHIVED"].includes(election.status) && <MotionCard className="application-banner">
      <div><p className="eyebrow">Voter registration</p><h2>Join the official voter roll</h2><p>Apply to participate; the election organizer will review your request.</p></div>
      <Button onClick={() => action(`/api/elections/${electionId}/register-voter`, { method: "POST" })}>Apply to vote</Button>
    </MotionCard>}
    {canParticipate && election.voter_status === "PENDING" && <Notice tone="info">Your voter-roll application is awaiting organizer review.</Notice>}
    {canParticipate && eligible && <Notice tone="success">You are approved on this election’s voter roll.</Notice>}

    <MotionCard className="turnout-card">
      <SectionHeading label="Live analytics · refreshes every 15 seconds" title="Voter turnout" />
      <TurnoutBars items={data.turnout} />
    </MotionCard>

    {receipts.length > 0 && <MotionCard>
      <SectionHeading label="Private participation receipts" title="Your ballot receipts" description="These signed codes confirm a ballot was recorded, without revealing your choice." />
      <div className="receipt-list">{receipts.map((item, index) => <div className="receipt-row" key={item.receipt}>
        <code>{item.receipt}</code>
        <div className="button-row">
          <Button variant="quiet" onClick={() => navigator.clipboard?.writeText(item.receipt)}>Copy</Button>
          <Button variant="secondary" onClick={() => verifyReceipt(item.receipt, index)}>Verify</Button>
        </div>
        {verifyMessages[index] && <small>{verifyMessages[index]}</small>}
      </div>)}</div>
    </MotionCard>}

    <MotionCard>
      <SectionHeading label="Political organizations" title="Contesting parties" description="Discover the teams and leaders participating in this election." action={
        canParticipate && eligible && inNomination ? <PartyRegistration electionId={electionId} onDone={refresh} /> : null
      } />
      <div className="party-grid">
        {data.parties.map((party) => <article className="party-tile" key={party.party_id}>
          <span className="tile-index">PARTY</span><h3>{party.party_name}</h3>
          <p>Led by {party.leader_name}</p>
          {canParticipate && eligible && inNomination && <Button variant="quiet" onClick={() => action(`/api/elections/${electionId}/parties/${party.party_id}/join`, { method: "POST" })}>Join party</Button>}
        </article>)}
        {data.parties.length === 0 && <p className="empty-state">No approved parties are contesting yet.</p>}
      </div>
    </MotionCard>

    {canParticipate && eligible && inNomination && <>
      <IndependentNomination electionId={electionId} positions={data.positions} onDone={refresh} setNotice={setNotice} />
      {isLeader && <PartyTicketForm electionId={electionId} members={members} positions={data.positions} onDone={refresh} setNotice={setNotice} />}
    </>}

    <div className="ballot-list">
      {Object.entries(groupedCandidates).map(([position, candidates]) => <MotionCard key={position} className="ballot-section">
        <SectionHeading label="Official candidates" title={position} />
        <div className="candidate-grid">{candidates.map((candidate, index) => <motion.article
          className="candidate-tile" key={candidate.candidate_id}
          whileHover={{ y: -4, rotateY: index % 2 ? -1 : 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 22 }}
        >
          <span className="candidate-monogram">{candidate.name.trim().slice(0, 1).toUpperCase()}</span>
          <h3>{candidate.name}</h3><p>{candidate.manifesto || "No manifesto provided."}</p>
          {canParticipate && eligible && election.status === "ACTIVE" && <Button onClick={() => castVote(candidate.candidate_id)}>Vote for candidate</Button>}
          {canParticipate && eligible && inNomination && candidate.candidate_pid === user?.pid && <Button variant="danger" onClick={() => action(`/api/elections/${electionId}/candidates/${candidate.candidate_id}/withdraw`, { method: "POST" })}>Withdraw nomination</Button>}
        </motion.article>)}</div>
      </MotionCard>)}
      {data.candidates.length === 0 && <MotionCard><p className="empty-state">Approved candidates will appear here.</p></MotionCard>}
    </div>
  </PageLayout>;
}

function PartyRegistration({ electionId, onDone }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const { data } = await api(`/api/elections/${electionId}/register-party`, { method: "POST", body: form });
      setMessage(data.message); setOpen(false); onDone();
    } catch (error) { setMessage(error.message); }
  }
  return <>
    <Button variant="secondary" onClick={() => setOpen((value) => !value)}>{open ? "Cancel" : "Form a party"}</Button>
    {message && <small className="form-feedback">{message}</small>}
    {open && <form className="inline-form" onSubmit={submit}>
      <Field label="Party name" name="party_name" required />
      <Field label="Manifesto" name="manifesto" as="textarea" rows="2" />
      <Button>Submit party</Button>
    </form>}
  </>;
}

function IndependentNomination({ electionId, positions, onDone, setNotice }) {
  async function submit(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const { data } = await api(`/api/elections/${electionId}/nominate-independent`, { method: "POST", body: { position_id: Number(form.position_id), manifesto: form.manifesto } });
      setNotice({ tone: "success", text: data.message }); event.currentTarget.reset(); onDone();
    } catch (error) { setNotice({ tone: "error", text: error.message }); }
  }
  return <MotionCard>
    <SectionHeading label="Your campaign" title="Run as an independent" description="Submit a self-nomination for organizer review." />
    <form className="form-stack compact-form" onSubmit={submit}>
      <Field label="Ballot position" name="position_id" as="select" required defaultValue="">
        <option value="" disabled>Select a position</option>
        {positions.map((position) => <option value={position.position_id} key={position.position_id}>{position.title}</option>)}
      </Field>
      <Field label="Manifesto" name="manifesto" as="textarea" rows="3" maxLength="1500" />
      <Button disabled={!positions.length}>Submit nomination</Button>
    </form>
  </MotionCard>;
}

function PartyTicketForm({ electionId, members, positions, onDone, setNotice }) {
  async function submit(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const { data } = await api(`/api/elections/${electionId}/assign-candidate`, {
        method: "POST",
        body: { member_pid: Number(form.member_pid), position: form.position, manifesto: form.manifesto }
      });
      setNotice({ tone: "success", text: data.message }); event.currentTarget.reset(); onDone();
    } catch (error) { setNotice({ tone: "error", text: error.message }); }
  }
  return <MotionCard>
    <SectionHeading label="Party leader workspace" title="Assign a candidate ticket" description="Only approved party members can receive a ticket." />
    <form className="form-stack compact-form" onSubmit={submit}>
      <Field label="Approved party member" name="member_pid" as="select" required defaultValue="">
        <option value="" disabled>Select a member</option>
        {members.map((member) => <option value={member.pid} key={member.pid}>{member.name} · {member.email}</option>)}
      </Field>
      <Field label="Ballot position" name="position" as="select" required defaultValue="">
        <option value="" disabled>Select a position</option>
        {positions.map((position) => <option value={position.title} key={position.position_id}>{position.title}</option>)}
      </Field>
      <Field label="Manifesto" name="manifesto" as="textarea" rows="3" />
      <Button disabled={!members.length || !positions.length}>Submit ticket for review</Button>
    </form>
  </MotionCard>;
}

function TurnoutBars({ items = [] }) {
  if (!items.length) return <p className="muted">Turnout will appear when ballot positions are configured.</p>;
  return <div className="turnout-list">{items.map((item) => {
    const percent = Math.max(0, Math.min(100, Number(item.turnout_percent) || 0));
    return <div className="turnout-item" key={item.position_id}>
      <div className="turnout-label"><strong>{item.position}</strong><span>{item.ballots_cast} / {item.eligible_voters} · {percent}%</span></div>
      <div className="turnout-track" role="progressbar" aria-valuenow={percent} aria-valuemin="0" aria-valuemax="100">
        <motion.span initial={{ width: 0 }} animate={{ width: `${percent}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
      </div>
    </div>;
  })}</div>;
}

function ResultsPage() {
  const [params] = useSearchParams();
  const electionId = params.get("id");
  const [notice, setNotice] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const { data, error, loading } = usePageData(async () => {
    if (!electionId) throw new Error("Election ID is missing.");
    const { data } = await api(`/api/elections/${electionId}/results`);
    return data;
  }, [electionId]);
  if (loading) return <LoadingScreen label="Verifying the official tally" />;
  if (error) return <PageLayout eyebrow="Official results"><Notice tone="error">{error}</Notice></PageLayout>;
  const grouped = groupBy(data?.results || [], (row) => row.position);
  return <PageLayout eyebrow="Transparent by design" title="Official results">
    <div className="results-hero">
      <div><p className="eyebrow">Certified VoteCore tally</p><h1>{data?.election_title || "The numbers, verified."}</h1><p>Individual voter selections are never included in this report.</p></div>
      {data?.status === "COMPLETED" && <Button disabled={downloading} onClick={async () => {
        setDownloading(true); setNotice(null);
        try {
          await downloadFile(`/api/elections/${electionId}/results/export`, `votecore-election-${electionId}-official-results.pdf`);
        } catch (err) {
          setNotice({ tone: "error", text: err.message });
        } finally {
          setDownloading(false);
        }
      }}>{downloading ? "Preparing PDF…" : <>Download official PDF <span>↓</span></>}</Button>}
    </div>
    <Notice tone={notice?.tone}>{notice?.text}</Notice>
    {Object.entries(grouped).map(([position, candidates]) => {
      const winner = candidates[0];
      return <MotionCard key={position} className="result-position">
        <SectionHeading label="Official result" title={position} />
        {winner?.total_votes > 0 && <div className="winner-panel"><span className="winner-star">✳</span><div><p className="eyebrow">Leading candidate</p><h3>{winner.candidate_name}</h3><p>{winner.total_votes} votes</p></div></div>}
        <div className="result-list">{candidates.map((candidate) => <div className="result-row" key={candidate.candidate_id}>
          <span>{candidate.candidate_name}</span><strong>{candidate.total_votes}</strong>
        </div>)}</div>
      </MotionCard>;
    })}
    {!Object.keys(grouped).length && <MotionCard><p className="empty-state">No approved candidates or results are available.</p></MotionCard>}
  </PageLayout>;
}

function ProfilePage() {
  const { data, error, loading } = usePageData(async () => {
    const { data } = await api("/api/auth/profile");
    return data.profile;
  }, []);
  const { setUser } = useSession();
  const navigate = useNavigate();

  async function logoutEverywhere() {
    if (!window.confirm("Sign out all active sessions?")) return;
    try {
      await api("/api/auth/logout-all", { method: "POST" });
    } catch (err) { window.alert(err.message); }
    clearUser(); setUser(null); navigate("/");
  }

  if (loading) return <LoadingScreen label="Loading your verified profile" />;
  if (error) return <PageLayout eyebrow="Your identity"><Notice tone="error">{error}</Notice></PageLayout>;
  return <PageLayout eyebrow="Personal details" title="Your verified profile">
    <div className="profile-grid">
      <MotionCard><SectionHeading label="Account" title={`${data.first_name} ${data.last_name}`} />
        <ProfileLine label="Email" value={data.email} /><ProfileLine label="Mobile" value={data.mobile} />
        <ProfileLine label="Location" value={[data.state, data.country].filter(Boolean).join(", ")} />
        <Button variant="danger" onClick={logoutEverywhere}>Log out all devices</Button>
      </MotionCard>
      <MotionCard><SectionHeading label="Identity wallet" title="Protected credentials" />
        <ProfileLine label="Voter ID / EPIC" value={data.voter_id} />
        <ProfileLine label="Government ID" value={data.aadhaar} />
        <ProfileLine label="Verification" value={data.is_verified ? "Verified" : "Not verified"} />
        <h3 className="subheading">Political affiliations</h3>
        {(data.organizations || []).map((organization, index) => <ProfileLine key={`${organization.org_name}-${index}`} label={organization.role} value={organization.org_name} />)}
      </MotionCard>
    </div>
  </PageLayout>;
}

function ProfileLine({ label, value }) {
  return <div className="profile-line"><span>{label}</span><strong>{value || "—"}</strong></div>;
}

function AdminPage() {
  const { user } = useSession();
  const [notice, setNotice] = useState(null);
  const [selectedElection, setSelectedElection] = useState("");
  const [logs, setLogs] = useState([]);
  const [logType, setLogType] = useState("");
  const [positionTitle, setPositionTitle] = useState("");
  const [phase, setPhase] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [downloadingLedger, setDownloadingLedger] = useState(false);
  const isSuperAdmin = user?.is_super_admin;
  const electionEndpoint = isSuperAdmin ? "/api/elections" : "/api/admin/my-elections";
  const { data, error, loading, refresh } = usePageData(async () => {
    const [electionsResponse, hostsResponse] = await Promise.all([
      api(electionEndpoint),
      isSuperAdmin ? api("/api/admin/host-requests") : Promise.resolve({ data: {} })
    ]);
    return {
      elections: electionsResponse.data.elections || electionsResponse.data.my_elections || [],
      hosts: isSuperAdmin ? hostsResponse.data.host_requests || [] : []
    };
  }, [electionEndpoint, isSuperAdmin, refreshKey]);
  const elections = data?.elections || [];
  const [review, setReview] = useState({ parties: [], candidates: [], voters: [] });

  useEffect(() => {
    if (!selectedElection || isSuperAdmin) return;
    Promise.all([
      api(`/api/admin/elections/${selectedElection}/pending-parties`),
      api(`/api/admin/elections/${selectedElection}/pending-candidates`),
      api(`/api/admin/elections/${selectedElection}/pending-voters`),
      api(`/api/elections/${selectedElection}/turnout`)
    ]).then(([parties, candidates, voters, turnout]) => {
      setReview({
        parties: parties.data.pending_parties || [],
        candidates: candidates.data.pending_candidates || [],
        voters: voters.data.pending_voters || [],
        turnout: turnout.data.positions || []
      });
    }).catch((err) => setNotice({ tone: "error", text: err.message }));
  }, [selectedElection, isSuperAdmin, refreshKey]);

  async function sendAction(path, method = "POST", body, success) {
    try {
      const { data: result } = await api(path, { method, body });
      setNotice({ tone: "success", text: success || result.message || "Updated." });
      setRefreshKey((key) => key + 1);
      return result;
    } catch (err) { setNotice({ tone: "error", text: err.message }); return null; }
  }

  async function loadLogs(type) {
    try {
      const { data: result } = await api(`/api/admin/${type}-logs`);
      setLogs(type === "audit" ? result.audit_logs || [] : result.fraud_logs || []);
      setLogType(type);
    } catch (err) { setNotice({ tone: "error", text: err.message }); }
  }

  async function addPosition(event) {
    event.preventDefault();
    if (!selectedElection || !positionTitle.trim()) return;
    const result = await sendAction(`/api/admin/elections/${selectedElection}/positions`, "POST", { title: positionTitle });
    if (result) setPositionTitle("");
  }

  async function updatePhase() {
    if (!selectedElection || !phase) return;
    await sendAction(`/api/admin/elections/${selectedElection}/status`, "PUT", { status: phase });
  }

  if (loading) return <LoadingScreen label="Opening management workspace" />;
  if (error) return <PageLayout eyebrow="Management"><Notice tone="error">{error}</Notice></PageLayout>;

  return <PageLayout eyebrow={isSuperAdmin ? "Platform authority" : "Election administration"} title={isSuperAdmin ? "Control center" : "Organizer workspace"}>
    <div className="admin-hero"><div><p className="eyebrow">The civic control room</p><h1>Run elections<br /><span>with precision.</span></h1></div><div className="admin-mark">0{isSuperAdmin ? "1" : "2"}<small>{isSuperAdmin ? "SUPER ADMIN" : "ORGANIZER"}</small></div></div>
    <Notice tone={notice?.tone}>{notice?.text}</Notice>

    {isSuperAdmin && <MotionCard>
      <SectionHeading label="PaaS provisioning" title="Hosting requests" description="Review institution applications to host elections." action={<Button variant="quiet" onClick={refresh}>Refresh</Button>} />
      <div className="review-list">
        {(data?.hosts || []).map((request) => <div className="review-row" key={request.request_id}>
          <div><p className="eyebrow">{request.org_name}</p><h3>{request.title}</h3><p>{request.description || "No description"} · {request.user_name}</p></div>
          <div className="button-row">
            <Button onClick={() => sendAction(`/api/admin/host-requests/${request.request_id}/approve`, "POST")}>Provision</Button>
            <Button variant="danger" onClick={() => sendAction(`/api/admin/host-requests/${request.request_id}/reject`, "POST")}>Reject</Button>
          </div>
        </div>)}
        {!data?.hosts?.length && <p className="empty-state">No pending hosting requests.</p>}
      </div>
    </MotionCard>}

    {!isSuperAdmin && <MotionCard className="admin-tools">
      <SectionHeading label="Election setup" title="Lifecycle and ballot positions" />
      <div className="form-row admin-form-row">
        <Field label="Your election" as="select" value={selectedElection} onChange={(event) => {
          setSelectedElection(event.target.value);
          const current = elections.find((item) => String(item.election_id) === event.target.value);
          setPhase(current?.status || "");
        }}>
          <option value="">Select an election</option>
          {elections.map((election) => <option value={election.election_id} key={election.election_id}>{election.title} · {election.status}</option>)}
        </Field>
        <Field label="Election phase" as="select" value={phase} onChange={(event) => setPhase(event.target.value)}>
          <option value="">Select phase</option>
          {["UPCOMING", "NOMINATION", "ACTIVE", "COMPLETED"].map((item) => <option key={item}>{item}</option>)}
        </Field>
        <Button onClick={updatePhase} disabled={!selectedElection || !phase}>Update phase</Button>
      </div>
      <form className="inline-form" onSubmit={addPosition}>
        <Field label="New ballot position" value={positionTitle} onChange={(event) => setPositionTitle(event.target.value)} placeholder="e.g. Secretary" required />
        <Button variant="secondary" disabled={!selectedElection}>Add position</Button>
      </form>
    </MotionCard>}

    {!isSuperAdmin && selectedElection && <>
      <MotionCard><SectionHeading label="Live analytics" title="Voter turnout" /><TurnoutBars items={review.turnout || []} /></MotionCard>
      <MotionCard><SectionHeading label="Voter roll" title="Applications" />
        <ReviewList empty="No pending voter applications." items={review.voters} render={(voter) => <div><strong>{voter.name}</strong><p>{voter.email}</p></div>} actions={(voter) => <>
          <Button onClick={() => sendAction(`/api/admin/elections/${selectedElection}/approve-voter`, "POST", { pid: voter.pid })}>Approve</Button>
          <Button variant="danger" onClick={() => sendAction(`/api/admin/elections/${selectedElection}/reject-voter`, "POST", { pid: voter.pid })}>Reject</Button>
        </>} />
      </MotionCard>
      <MotionCard><SectionHeading label="Party registration" title="Party applications" />
        <ReviewList empty="No pending party registrations." items={review.parties} render={(party) => <div><strong>{party.party_name}</strong><p>Leader: {party.leader_name}</p></div>} actions={(party) => <>
          <Button onClick={() => sendAction(`/api/admin/parties/${party.party_id}/approve`)}>Approve</Button>
          <Button variant="danger" onClick={() => sendAction(`/api/admin/parties/${party.party_id}/reject`)}>Reject</Button>
        </>} />
      </MotionCard>
      <MotionCard><SectionHeading label="Candidate scrutiny" title="Candidate tickets" />
        <ReviewList empty="No pending or active candidate tickets." items={review.candidates} render={(candidate) => <div><strong>{candidate.name} · {candidate.status}</strong><p>{candidate.position} · {candidate.manifesto || "No manifesto"}</p></div>} actions={(candidate) => candidate.status === "PENDING" ? <>
          <Button onClick={() => sendAction(`/api/admin/candidates/${candidate.candidate_id}/approve`)}>Approve</Button>
          <Button variant="danger" onClick={() => sendAction(`/api/admin/candidates/${candidate.candidate_id}/status`, "POST", { status: "REJECTED" })}>Reject</Button>
        </> : <Button variant="danger" onClick={() => sendAction(`/api/admin/candidates/${candidate.candidate_id}/status`, "POST", { status: "WITHDRAWN" })}>Withdraw</Button>} />
      </MotionCard>
    </>}

    <MotionCard><SectionHeading label="Accountability" title="Audit and security logs" />
      <div className="button-row">
        <Button variant="secondary" onClick={() => loadLogs("audit")}>Audit trail</Button>
        <Button variant="danger" onClick={() => loadLogs("fraud")}>Fraud alerts</Button>
      </div>
      {isSuperAdmin && <div className="export-row">
        <Field label="Election security ledger" as="select" value={selectedElection} onChange={(event) => setSelectedElection(event.target.value)}>
          <option value="">Select election</option>{elections.map((item) => <option value={item.election_id} key={item.election_id}>{item.title}</option>)}
        </Field>
        <Button disabled={!selectedElection || downloadingLedger} onClick={async () => {
          setDownloadingLedger(true);
          try {
            await downloadFile(`/api/admin/elections/${selectedElection}/export-fraud-log`, `VoteCore_SecurityLedger_Elec${selectedElection}.pdf`);
          } catch (err) {
            setNotice({ tone: "error", text: err.message });
          } finally {
            setDownloadingLedger(false);
          }
        }}>{downloadingLedger ? "Preparing PDF…" : "Download PDF ledger"}</Button>
      </div>}
      {logType && <div className="table-scroll"><table><thead><tr>{(logType === "audit" ? ["ID", "User", "Action", "Details", "Time"] : ["ID", "User", "Alert", "Details", "Time"]).map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{logs.map((log) => <tr key={log.log_id || log.fraud_id}>
          <td>{log.log_id || log.fraud_id}</td><td>{log.user_name}</td><td>{log.action_type || log.fraud_type}</td><td>{log.details || log.description}</td><td>{log.action_time || log.detected_at}</td>
        </tr>)}</tbody></table></div>}
    </MotionCard>
  </PageLayout>;
}

function ReviewList({ items, render, actions, empty }) {
  if (!items?.length) return <p className="empty-state">{empty}</p>;
  return <div className="review-list">{items.map((item, index) => <div className="review-row" key={item.request_id || item.party_id || item.candidate_id || item.pid || index}>
    <div>{render(item)}</div><div className="button-row">{actions(item)}</div>
  </div>)}</div>;
}

function Modal({ title, children, onClose }) {
  const shouldReduceMotion = useReducedMotion();
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <motion.section
      className="modal-card"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      role="dialog" aria-modal="true" aria-label={title}
    >
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></div>
      {children}
    </motion.section>
  </motion.div>;
}

function groupBy(items, selector) {
  return items.reduce((groups, item) => {
    const key = selector(item);
    (groups[key] ||= []).push(item);
    return groups;
  }, {});
}

function readReceipts(electionId) {
  if (!electionId) return [];
  try {
    const stored = JSON.parse(localStorage.getItem(`voteReceipts:${electionId}`) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export default App;
