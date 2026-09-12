const API_URL = "http://127.0.0.1:5000";

let currentAuthAction = 'login';
let pendingRegEmail = '';
let myElectionsCache = []; // Remembers the real database statuses for the Organizer Panel

const nativeFetch = window.fetch.bind(window);
window.fetch = function (input, init = {}) {
    let url = typeof input === "string" ? input : input.url;
    const method = (init.method || (input instanceof Request && input.method) || "GET").toUpperCase();
    if (url.startsWith(API_URL)) {
        if (method === "GET") {
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}_t=${new Date().getTime()}`;
        }
        if (!["GET", "HEAD", "OPTIONS"].includes(method) && !url.endsWith("/api/auth/logout")) {
            const csrfToken = localStorage.getItem("votingCsrfToken");
            if (csrfToken) {
                init.headers = new Headers(init.headers || {});
                init.headers.set("X-CSRF-Token", csrfToken);
            }
        }
    }
    return nativeFetch(url, init);
};

function toggleForms() {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const otpForm = document.getElementById("otpForm");
    if (loginForm && loginForm.style.display === "none" && (!otpForm || otpForm.style.display === "none")) {
        loginForm.style.display = "block";
        if (registerForm) registerForm.style.display = "none";
        if (otpForm) otpForm.style.display = "none";
    } else {
        if (loginForm) loginForm.style.display = "none";
        if (registerForm) registerForm.style.display = "block";
        if (otpForm) otpForm.style.display = "none";
    }
}

async function checkLoginStatus() {
    window.scrollTo(0, 0);
    const user = await refreshUserFromBackend();
    if (user) window.location.href = (user.is_super_admin || user.is_organizer) ? "admin.html" : "dashboard.html";
}

function getCurrentUser() {
    const savedUser = localStorage.getItem("votingUser");
    if (!savedUser) return null;
    try { return JSON.parse(savedUser); } catch (e) { return null; }
}

function saveCurrentUser(user) {
    if (!user) return;
    localStorage.setItem("votingUser", JSON.stringify(user));
}

function displayWelcome() {
    const welcome = document.getElementById("welcome");
    if (!welcome) return;
    const user = getCurrentUser();
    if (!user) { welcome.innerText = "Welcome!"; return; }
    const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    welcome.innerText = fullName ? `Welcome, ${fullName}!` : (user.email ? `Welcome, ${user.email}!` : "Welcome!");
}

function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function refreshUserFromBackend() {
    try {
        const response = await fetch(`${API_URL}/api/auth/me`, { method: "GET", credentials: "include" });
        if (!response.ok) return getCurrentUser();
        const data = await response.json();
        if (data.user) {
            if (data.csrf_token) localStorage.setItem("votingCsrfToken", data.csrf_token);
            saveCurrentUser(data.user);
            return data.user;
        }
        return getCurrentUser();
    } catch (e) { return getCurrentUser(); }
}

async function registerUser() {
    const firstName = document.getElementById("regFirstName").value.trim();
    const lastName = document.getElementById("regLastName").value.trim();
    const mobile = document.getElementById("regMobile").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    const confirmPassword = document.getElementById("regConfirmPassword").value;
    const dob = document.getElementById("regDob").value;
    const aadhaar = document.getElementById("regAadhaar").value.trim();
    const voterId = document.getElementById("regVoterId").value.trim().toUpperCase();
    const country = document.getElementById("regCountry") ? document.getElementById("regCountry").value : "India";
    const state = document.getElementById("regState") ? document.getElementById("regState").value : "";
    
    const msg = document.getElementById("regMessage");
    msg.style.display = "block"; 
    msg.style.color = "white";

    if (!firstName || !lastName || !email || !mobile || !password || !confirmPassword || !dob || !aadhaar || !voterId || !state) {
        msg.style.backgroundColor = "#e74c3c"; 
        msg.innerText = "All fields marked with * are required."; 
        return;
    }
    if (password !== confirmPassword) {
        msg.style.backgroundColor = "#e74c3c"; 
        msg.innerText = "Passwords do not match."; 
        return;
    }
    msg.style.backgroundColor = "#f39c12"; 
    msg.innerText = "Verifying Requirements & Generating OTP...";

    try {
        const response = await fetch(`${API_URL}/api/auth/register`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                first_name: firstName, last_name: lastName, mobile: mobile, email: email,
                password: password, dob: dob, aadhaar: aadhaar, voter_id: voterId,
                country: country, state: state
            })
        });
        const data = await response.json();
        if (!response.ok) { msg.style.backgroundColor = "#e74c3c"; msg.innerText = data.error; return; }

        if (data.requires_otp) {
            currentAuthAction = 'register';
            pendingRegEmail = data.email;
            document.getElementById("registerForm").style.display = "none";
            document.getElementById("otpForm").style.display = "block";
            const otpMsg = document.getElementById("otpMessage");
            otpMsg.style.display = "block"; otpMsg.style.backgroundColor = "#3498db";
            otpMsg.style.color = "white"; otpMsg.innerText = "Registration OTP Sent to email!";
        }
    } catch (e) { msg.style.backgroundColor = "#e74c3c"; msg.innerText = "Backend is offline."; }
}

async function login() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const msg = document.getElementById("message");

    if (!email || !password) { msg.innerText = "Enter email and password."; return; }
    msg.style.color = "#333"; msg.innerText = "Authenticating...";

    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, password: password })
        });
        const data = await response.json();
        if (!response.ok) { msg.style.color = "#e74c3c"; msg.innerText = data.error; return; }

        if (data.requires_otp) {
            currentAuthAction = 'login';
            document.getElementById("loginForm").style.display = "none";
            document.getElementById("otpForm").style.display = "block";
            const otpMsg = document.getElementById("otpMessage");
            otpMsg.style.display = "block"; otpMsg.style.backgroundColor = "#3498db";
            otpMsg.style.color = "white"; otpMsg.innerText = "OTP Sent to email! (Check server terminal if email fails)";
        }
    } catch (e) { msg.style.color = "#e74c3c"; msg.innerText = "Backend is offline."; }
}

async function verifyOTP() {
    const otpCode = document.getElementById("otpCode").value.trim();
    const msg = document.getElementById("otpMessage");

    if (!otpCode || otpCode.length !== 6) { msg.style.backgroundColor = "#e74c3c"; msg.innerText = "Enter a valid 6-digit OTP."; return; }
    msg.style.backgroundColor = "#f39c12"; msg.innerText = "Verifying...";

    if (currentAuthAction === 'register') {
        try {
            const response = await fetch(`${API_URL}/api/auth/register-verify`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: pendingRegEmail, otp: otpCode })
            });
            const data = await response.json();
            if (!response.ok) { msg.style.backgroundColor = "#e74c3c"; msg.innerText = data.error; return; }

            msg.style.backgroundColor = "#2ecc71"; msg.innerText = "Registration verified! Redirecting to login...";
            setTimeout(() => { 
                document.getElementById("otpForm").style.display = "none";
                document.getElementById("loginForm").style.display = "block";
                document.getElementById("email").value = pendingRegEmail;
                pendingRegEmail = '';
                msg.style.display = "none";
            }, 2000);
        } catch (e) { msg.style.backgroundColor = "#e74c3c"; msg.innerText = "Backend is offline."; }
    } else {
        try {
            const response = await fetch(`${API_URL}/api/auth/verify-otp`, {
                method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ otp: otpCode })
            });
            const data = await response.json();
            if (!response.ok) { msg.style.backgroundColor = "#e74c3c"; msg.innerText = data.error; return; }

            if (data.csrf_token) localStorage.setItem("votingCsrfToken", data.csrf_token);
            if (data.user) saveCurrentUser(data.user);
            msg.style.backgroundColor = "#2ecc71"; msg.innerText = "Login Verified! Redirecting...";
            
            setTimeout(() => {
                window.location.href = (data.user && (data.user.is_super_admin || data.user.is_organizer)) ? "admin.html" : "dashboard.html";
            }, 1000);
        } catch (e) { msg.style.backgroundColor = "#e74c3c"; msg.innerText = "Backend is offline."; }
    }
}

async function logout() {
    try { await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" }); } catch (e) {}
    localStorage.removeItem("votingUser");
    localStorage.removeItem("votingCsrfToken");
    window.location.href = "index.html";
}

async function logoutAllDevices() {
    if (!confirm("Sign out of VoteCore on every device?")) return;
    try { await fetch(`${API_URL}/api/auth/logout-all`, { method: "POST", credentials: "include" }); } catch (e) {}
    localStorage.removeItem("votingUser");
    localStorage.removeItem("votingCsrfToken");
    window.location.href = "index.html";
}

async function loadProfile() {
    const orgsList = document.getElementById("profOrgs");
    try {
        const response = await fetch(`${API_URL}/api/auth/profile`, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) { if (response.status === 401) window.location.href = "index.html"; return; }

        const p = data.profile;
        let mobileStr = p.mobile ? String(p.mobile) : "";
        if (mobileStr.length > 4) { mobileStr = mobileStr.slice(0, -4) + "XXXX"; }
        
        document.getElementById("profName").value = `${p.first_name || ""} ${p.last_name || ""}`.trim();
        document.getElementById("profEmail").value = p.email || "";
        document.getElementById("profMobile").value = mobileStr;
        
        document.getElementById("profVoterId").innerText = p.voter_id;
        document.getElementById("profAadhaar").innerText = p.aadhaar;
        document.getElementById("profStatus").innerText = p.is_verified ? "✅ Verified & Locked" : "❌ Unverified";

        orgsList.innerHTML = "";
        const orgs = Array.isArray(p.organizations) ? p.organizations : [];
        if (orgs.length === 0) {
            orgsList.innerHTML = "<li style='color: #64748b;'>No party allegiances registered.</li>";
        } else {
            orgs.forEach(org => {
                const li = document.createElement("li");
                li.style.padding = "10px 0";
                li.style.borderBottom = "1px solid #334155";
                li.innerHTML = `<strong>${escapeHtml(org.org_name)}</strong> <span style="float:right; color:#f39c12; font-size:0.8em; padding-top:4px;">${escapeHtml(org.role)}</span>`;
                orgsList.appendChild(li);
            });
        }
    } catch (e) {}
}

async function loadDashboard() {
    displayWelcome();
    const user = await refreshUserFromBackend();
    if (!user) { window.location.href = "index.html"; return; }

    if (user.is_super_admin) {
        const btn = document.getElementById("superAdminBtnContainer");
        if (btn) btn.style.display = "block";
    }
    if (user.is_organizer) {
        const btn = document.getElementById("organizerBtnContainer");
        if (btn) btn.style.display = "block";
    }

    const electionsElement = document.getElementById("elections");
    electionsElement.innerText = "Decrypting civic ledger...";
    try {
        const response = await fetch(`${API_URL}/api/elections`, { method: "GET", credentials: "include" });
        const data = await response.json();
        if (!response.ok) { electionsElement.innerText = "Failed to load elections."; return; }
        
        const elections = data.elections || [];
        if (elections.length === 0) { electionsElement.innerText = "No elections available."; return; }

        electionsElement.innerHTML = "";
        elections.forEach(function (election) {
            let phaseColor = "#333";
            if (election.status === "ACTIVE") phaseColor = "#2ecc71";
            if (election.status === "NOMINATION") phaseColor = "#f39c12";

            const div = document.createElement("div");
            div.className = "election-card";
            let html = `
                <h3>${escapeHtml(election.title)}</h3>
                <p>${escapeHtml(election.description || "")}</p>
                <p><strong style="color: ${phaseColor};">Phase: ${escapeHtml(election.status)}</strong></p>
                <button onclick="viewElection(${election.election_id})" style="margin-top: 10px;">View Election</button>
                <button onclick="viewResults(${election.election_id})" style="margin-top: 10px; background-color: #34495e;">View Results</button>
            `;
            
            // If user is Super Admin and Election is COMPLETED, show the Remove button
            if (user.is_super_admin && election.status === "COMPLETED") {
                html += `<button onclick="removeElection(${election.election_id})" style="margin-top: 10px; background-color: #e74c3c;">Remove Election</button>`;
            }
            
            div.innerHTML = html;
            electionsElement.appendChild(div);
        });
    } catch (error) { electionsElement.innerText = "Cannot connect to backend."; }
}

async function removeElection(electionId) {
    if (!confirm("Are you sure you want to remove this completed election? It will be safely archived and hidden from all users.")) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/elections/${electionId}`, {
            method: "DELETE", credentials: "include"
        });
        const data = await response.json();
        
        if (response.ok) {
            alert(data.message);
            loadDashboard(); // Refresh the page so the election disappears
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) {
        alert("Cannot connect to backend.");
    }
}

function viewElection(electionId) { window.location.href = `election.html?id=${electionId}`; }
function viewResults(electionId) { window.location.href = `results.html?id=${electionId}`; }

// ============================================================
// DYNAMIC ELECTION VIEW (WITH TICKET DELEGATION)
// ============================================================
async function loadElection() {
    displayWelcome();
    const user = await refreshUserFromBackend();
    if (!user) { window.location.href = "index.html"; return; }

    const params = new URLSearchParams(window.location.search);
    const electionId = params.get("id");
    const candidatesElement = document.getElementById("candidates");

    try {
        const electionResponse = await fetch(`${API_URL}/api/elections/${electionId}`, { method: "GET", credentials: "include" });
        const electionData = await electionResponse.json();
        const electionInfo = electionData.election;
        
        if (electionResponse.ok) {
            document.getElementById("electionTitle").innerText = electionInfo.title || "";
            document.getElementById("electionDescription").innerText = electionInfo.description || "";
            document.getElementById("electionStatus").innerText = `Phase: ${electionInfo.status || ""}`;
        }

        let html = `<div class="content-divider"></div>`;

        const isSuperAdmin = user.is_super_admin;
        const isOrganizer = electionInfo.organizer_pid === user.pid;
        const canParticipate = !isSuperAdmin && !isOrganizer;
        const isEligible = electionInfo.voter_status === "ELIGIBLE";
        const isNominationPhase = electionInfo.status === "NOMINATION";
        const isActivePhase = electionInfo.status === "ACTIVE";

        if (!electionInfo.has_organizer) {
            if (!isSuperAdmin) {
                html += `<div class="section-heading compact" style="text-align: center; display: flex; flex-direction: column; align-items: center; padding: 2rem 0;">
                            <h2 style="margin-bottom: 10px;">Election Administrator Needed</h2>
                            <p style="color: #5B6478; max-width: 500px;">This election requires a neutral Organizer before parties can register or voters can apply.</p>
                            <button class="btn btn-gold" onclick="applyToOrganize(${electionId})" style="margin-top: 1rem;">Apply to be Organizer</button>
                         </div>`;
            } else {
                html += `<div class="section-heading compact" style="text-align: center; padding: 2rem 0;">
                            <h2 style="margin-bottom: 10px;">Awaiting Organizer</h2>
                            <p style="color: #5B6478;">This election is paused until an Organizer applies and is appointed by you in the Admin Panel.</p>
                         </div>`;
            }
            candidatesElement.innerHTML = html;
            return;
        }

        if (canParticipate) {
            if (!electionInfo.voter_status) {
                html += `<div class="role-banner" style="background: linear-gradient(110deg, #f39c12, #e67e22); border-color: #f1c40f; margin-bottom: 20px;">
                            <span>📝</span>
                            <div>
                                <h2 style="color: #FFF; margin-bottom: 5px;">Voter Registration Required</h2>
                                <p style="color: #FFF;">You must be on the official voter roll to participate, join parties, or vote in this election.</p>
                                <button class="btn btn-neutral" onclick="registerForVoterRoll(${electionId})" style="margin-top: 10px; color: #333;">Apply for Voter Roll</button>
                            </div>
                         </div>`;
            } else if (electionInfo.voter_status === 'PENDING') {
                html += `<div class="role-banner" style="background: #34495e; border-color: #2c3e50; margin-bottom: 20px;">
                            <span>⏳</span>
                            <div>
                                <h2 style="color: #FFF; margin-bottom: 5px;">Application Pending</h2>
                                <p style="color: #FFF;">Your request to join the voter roll is currently awaiting Organizer approval.</p>
                            </div>
                         </div>`;
            } else if (electionInfo.voter_status === 'ELIGIBLE') {
                html += `<div class="role-banner" style="background: linear-gradient(110deg, #2ecc71, #27ae60); border-color: #2ecc71; margin-bottom: 20px;">
                            <span>✅</span>
                            <div>
                                <h2 style="color: #FFF; margin-bottom: 5px;">Voter Roll Approved</h2>
                                <p style="color: #FFF;">You are officially whitelisted to participate in this election.</p>
                            </div>
                         </div>`;
            }
        }

        const partyResponse = await fetch(`${API_URL}/api/elections/${electionId}/parties`, { method: "GET", credentials: "include" });
        const partyData = await partyResponse.json();
        
        let amIPartyLeader = false;

        html += `<div class="section-heading compact"><div><p class="card-kicker">Political Organizations</p><h2>Contesting Parties</h2></div>`;
        if (canParticipate && isEligible && isNominationPhase) {
            html += `<button class="btn btn-gold" onclick="registerNewParty(${electionId})">+ Form a New Party</button>`;
        }
        html += `</div>`;
        
        html += `<div class="election-grid" style="margin-bottom: 2rem;">`;
        if (partyData.parties && partyData.parties.length > 0) {
            partyData.parties.forEach(p => {
                if (p.leader_pid === user.pid) amIPartyLeader = true;
                html += `<div class="election-card">
                    <h3>${escapeHtml(p.party_name)}</h3>
                    <p>Leader: <strong>${escapeHtml(p.leader_name)}</strong></p>`;
                if (canParticipate && isEligible && isNominationPhase) {
                    html += `<button class="btn btn-neutral" onclick="joinParty(${electionId}, ${p.party_id}, '${escapeHtml(p.party_name)}')">Join Party</button>`;
                }
                html += `</div>`;
            });
        } else {
            if (electionInfo.status === "UPCOMING") {
                html += `<p style="color: #5B6478; grid-column: 1 / -1;">Party registration will open during the Nomination phase.</p>`;
            } else {
                html += `<p style="color: #5B6478; grid-column: 1 / -1;">No parties have been approved yet.</p>`;
            }
        }
        html += `</div>`;

        // TICKET DELEGATION CONTROL PANEL (ONLY FOR PARTY LEADERS)
        if (canParticipate && isEligible && isNominationPhase && amIPartyLeader) {
            html += `<div class="ticket-delegation-panel">
                        <div style="margin-bottom: 15px;">
                            <span style="color: #f39c12; font-weight: bold; font-size: 16px;">👑 Party Leader Controls: Delegate Tickets</span>
                        </div>
                        <div class="inline-form" style="gap: 15px; flex-wrap: wrap; align-items: flex-start;">
                            <div style="flex: 1; min-width: 200px;">
                                <label style="font-size: 13px; color: #94a3b8; display: block; margin-bottom: 5px;">1. Select Party Member</label>
                                <select id="delegateMemberSelect" style="width: 100%; padding: 10px; background: #0f172a; border: 1px solid #334155; color: white; border-radius: 4px;">
                                    <option value="">Loading members...</option>
                                </select>
                            </div>
                            <div style="flex: 1; min-width: 200px;">
                                <label style="font-size: 13px; color: #94a3b8; display: block; margin-bottom: 5px;">2. Select Ballot Position</label>
                                <select id="delegatePositionSelect" style="width: 100%; padding: 10px; background: #0f172a; border: 1px solid #334155; color: white; border-radius: 4px;">
                                    <option value="">Loading positions...</option>
                                </select>
                            </div>
                        </div>
                        <div style="margin-top: 15px;">
                            <label style="font-size: 13px; color: #94a3b8; display: block; margin-bottom: 5px;">3. Campaign Manifesto / Slogan</label>
                            <input type="text" id="delegateManifesto" placeholder="Enter campaign slogan..." style="width: 100%; padding: 10px; background: #0f172a; border: 1px solid #334155; color: white; border-radius: 4px; margin-bottom: 15px;">
                            <button class="btn btn-violet" onclick="assignCandidate(${electionId})">Assign Ticket to Member</button>
                        </div>
                     </div>`;
        }

        const candidateResponse = await fetch(`${API_URL}/api/elections/${electionId}/candidates`, { method: "GET", credentials: "include" });
        const candidateData = await candidateResponse.json();
        const candidates = candidateData.candidates || [];
        
        if (candidates.length === 0) {
            if (electionInfo.status === "UPCOMING") {
                html += `<p style="color: #5B6478;">Candidate tickets will be assigned by Party Leaders during the Nomination phase.</p>`;
            } else {
                html += `<p style="color: #5B6478;">No candidates approved for this election yet.</p>`;
            }
        } else {
            const grouped = {};
            candidates.forEach(c => {
                if(!grouped[c.position]) grouped[c.position] = [];
                grouped[c.position].push(c);
            });

            for (const [position, cands] of Object.entries(grouped)) {
                html += `<div class="content-divider"></div>`;
                html += `<div class="section-heading compact"><div><p class="card-kicker">Official Ballot</p><h2>${escapeHtml(position)}</h2></div></div>`;
                html += `<div class="candidate-grid" style="margin-bottom: 2rem;">`;
                cands.forEach(candidate => {
                    html += `
                        <div class="candidate-card">
                            <h3>${escapeHtml(candidate.name)}</h3>
                            <p><strong>Manifesto:</strong> ${escapeHtml(candidate.manifesto || "No manifesto provided.")}</p>`;
                    if (canParticipate && isEligible && isActivePhase) {
                        html += `<button class="vote-button" onclick="castVote(${electionId}, ${candidate.candidate_id})">Vote for ${escapeHtml(candidate.name)}</button>`;
                    }
                    html += `</div>`;
                });
                html += `</div>`;
            }
        }
        candidatesElement.style.display = "block";
        candidatesElement.innerHTML = html;

        // Automatically fetch dropdown data if this user is a leader
        if (amIPartyLeader) {
            fetchPartyMembersForDelegation(electionId);
            fetchPositionsForDelegation(electionId);
        }

    } catch (error) { candidatesElement.innerText = "Cannot connect to backend."; }
}

async function registerForVoterRoll(electionId) {
    if (!confirm("Submit your application to join the official voter roll for this election?")) return;
    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/register-voter`, { method: "POST", credentials: "include" });
        const data = await response.json();
        alert(response.ok ? data.message : "Error: " + data.error);
        if(response.ok) loadElection(); 
    } catch (e) { alert("Connection Error."); }
}

async function applyToOrganize(electionId) {
    if (!confirm("Are you sure you want to apply to be the Election Organizer?")) return;
    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/apply-organizer`, { method: "POST", credentials: "include" });
        const data = await response.json();
        alert(response.ok ? data.message : "Error: " + data.error);
    } catch (e) { alert("Connection Error."); }
}

async function registerNewParty(electionId) {
    const partyName = prompt("Enter the name of your new Political Party to contest in this election:");
    if (!partyName) return;
    
    const manifesto = prompt("Enter your campaign manifesto or slogan for your Presidential run:");
    if (manifesto === null) return; // Cancels if they hit 'Cancel'
    
    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/register-party`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                party_name: partyName, 
                manifesto: manifesto || "No manifesto provided." 
            })
        });
        const data = await response.json();
        alert(response.ok ? data.message : "Error: " + data.error);
        if(response.ok) loadElection();
    } catch (e) { alert("Connection Error."); }
}

async function joinParty(electionId, partyId, partyName) {
    if (!confirm(`Are you sure you want to pledge allegiance to ${partyName}?`)) return;
    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/parties/${partyId}/join`, {
            method: "POST", credentials: "include"
        });
        const data = await response.json();
        alert(response.ok ? data.message : "Error: " + data.error);
    } catch (e) { alert("Connection Error."); }
}

async function fetchPartyMembersForDelegation(electionId) {
    const select = document.getElementById("delegateMemberSelect");
    if (!select) return;
    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/my-party-members`, { credentials: "include" });
        const data = await response.json();
        if (response.ok && data.members && data.members.length > 0) {
            select.innerHTML = `<option value="">-- Choose a Member --</option>` + 
                data.members.map(m => `<option value="${m.pid}">${escapeHtml(m.name)} (${escapeHtml(m.email)})</option>`).join("");
        } else {
            select.innerHTML = `<option value="">No approved members in your party yet</option>`;
        }
    } catch (e) { select.innerHTML = `<option value="">Error loading members</option>`; }
}

async function fetchPositionsForDelegation(electionId) {
    const select = document.getElementById("delegatePositionSelect");
    if (!select) return;
    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/positions`, { credentials: "include" });
        const data = await response.json();
        if (response.ok && data.positions && data.positions.length > 0) {
            select.innerHTML = `<option value="">-- Choose a Position --</option>` + 
                data.positions.map(p => `<option value="${escapeHtml(p.title)}">${escapeHtml(p.title)}</option>`).join("");
        } else {
            select.innerHTML = `<option value="">No positions defined by Organizer</option>`;
        }
    } catch (e) { select.innerHTML = `<option value="">Error loading positions</option>`; }
}

async function assignCandidate(electionId) {
    const memberPid = document.getElementById("delegateMemberSelect").value;
    const position = document.getElementById("delegatePositionSelect").value;
    const manifesto = document.getElementById("delegateManifesto").value.trim();

    if (!memberPid) { alert("Please select a party member."); return; }
    if (!position) { alert("Please select a ballot position."); return; }
    
    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/assign-candidate`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ member_pid: parseInt(memberPid), position: position, manifesto: manifesto || "No manifesto provided." })
        });
        const data = await response.json();
        alert(response.ok ? data.message : "Error: " + data.error);
        if (response.ok) {
            document.getElementById("delegateManifesto").value = "";
            loadElection();
        }
    } catch (e) { alert("Cannot connect to backend."); }
}

async function castVote(electionId, candidateId) {
    if (!confirm("Are you sure you want to securely cast your vote for this candidate?")) return;
    
    // Freeze all buttons BEFORE the request so the user doesn't double-click
    const buttons = document.querySelectorAll(".vote-button");
    buttons.forEach(btn => {
        btn.dataset.originalText = btn.innerText; // Save original text
        btn.disabled = true;
        btn.innerText = "PROCESSING...";
    });

    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/vote`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidate_id: candidateId })
        });
        const data = await response.json();
        
        if (response.ok) {
            alert(data.message || "Ballot cryptographically sealed and cast!");
            // Refresh the election page so buttons unfreeze and you can vote for the next position
            loadElection(); 
            return;
        }
        
        // If the backend rejects the vote (e.g., "You already voted for this position")
        alert(data.error || "Unable to cast vote.");
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.innerText = btn.dataset.originalText; // Restore original text
        });
        
    } catch (e) {
        alert("Cannot connect to backend.");
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.innerText = btn.dataset.originalText;
        });
    }
}

async function loadResults() {
    displayWelcome();
    const params = new URLSearchParams(window.location.search);
    const electionId = params.get("id");
    const resultsElement = document.getElementById("results");
    if (!resultsElement) return;

    resultsElement.innerText = "Loading official tally...";
    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/results`, { method: "GET", credentials: "include" });
        const data = await response.json();
        if (!response.ok) { resultsElement.innerText = data.error || "Results are not available."; return; }

        const results = data.results || [];
        if (results.length === 0) { resultsElement.innerText = "No results available yet."; return; }
        
        resultsElement.innerHTML = "";
        resultsElement.style.display = "block";

        const grouped = {};
        results.forEach(r => {
            if(!grouped[r.position]) grouped[r.position] = [];
            grouped[r.position].push(r);
        });

        for (const [position, candidates] of Object.entries(grouped)) {
            const winner = candidates[0]; 
            let html = `<div class="content-divider"></div>`;
            html += `<div class="section-heading compact"><div><p class="card-kicker">Official Result</p><h2>${escapeHtml(position)}</h2></div></div>`;

            if (winner.total_votes > 0) {
                html += `<div class="role-banner" style="background: linear-gradient(110deg, #095F49, #0B1B33); border-color: #43d6a5; margin-bottom: 20px;">
                    <span>🏆</span>
                    <div>
                        <p class="card-kicker" style="color: #43d6a5;">Declared Winner</p>
                        <h2>${escapeHtml(winner.candidate_name)}</h2>
                        <p style="color: #FFF; font-weight: bold; font-family: monospace;">Secured with ${winner.total_votes} votes.</p>
                    </div>
                </div>`;
            } else {
                html += `<p style="color: #5B6478; font-style: italic; margin-bottom: 20px;">No votes were cast for this position.</p>`;
            }

            html += `<div class="results-grid" style="margin-bottom: 2rem;">`;
            candidates.forEach(cand => {
                const isWinnerStyle = (cand.candidate_id === winner.candidate_id && cand.total_votes > 0) 
                    ? 'border-color: #0B7A5F; box-shadow: 0 4px 12px rgba(11,122,95,0.15);' : '';
                html += `<div class="candidate-card" style="${isWinnerStyle}">
                    <h3>${escapeHtml(cand.candidate_name)}</h3>
                    <p><strong>Total Votes:</strong> ${cand.total_votes}</p>
                </div>`;
            });
            html += `</div>`;
            resultsElement.innerHTML += html;
        }
    } catch (error) { resultsElement.innerText = "Cannot connect to backend."; }
}

// ============================================================
// ADMIN AND ORGANIZER SCRUTINY PANELS
// ============================================================
async function loadAdminUI() {
    const user = await refreshUserFromBackend();
    if (!user || (!user.is_super_admin && !user.is_organizer)) { window.location.href = "index.html"; return; }

    if (user.is_super_admin) {
        const sAdmin = document.getElementById("superAdminSection");
        if(sAdmin) {
            sAdmin.style.display = "block";
            loadPendingOrganizers();
            loadSuperAdminElections(); // Populates the new PDF Export dropdown
        }
    } 
    
    if (user.is_organizer) {
        const orgAdmin = document.getElementById("organizerSection");
        if(orgAdmin) {
            orgAdmin.style.display = "block";
            loadOrganizerElections(); 
        }
    }
}

// NEW: Automates fetching elections for the Super Admin PDF dropdown
async function loadSuperAdminElections() {
    const select = document.getElementById("exportElectionId");
    if (!select) return;
    try {
        const response = await fetch(`${API_URL}/api/elections`, { credentials: "include" });
        const data = await response.json();
        if (response.ok && data.elections) {
            const options = data.elections.map(e => `<option value="${e.election_id}">${escapeHtml(e.title)} (Phase: ${e.status})</option>`).join("");
            select.innerHTML = options || `<option value="">No elections available</option>`;
        }
    } catch (e) {
        select.innerHTML = `<option value="">Error loading elections</option>`;
    }
}

async function loadOrganizerElections() {
    const phaseSelect = document.getElementById("phaseElectionId");
    const posSelect = document.getElementById("positionElectionId");
    const scrutinySelect = document.getElementById("scrutinyElectionId");
    const voterSelect = document.getElementById("voterRollElectionId");

    try {
        const res = await fetch(`${API_URL}/api/admin/my-elections`, { credentials: "include" });
        const data = await res.json();
        if (res.ok && data.my_elections) {
            myElectionsCache = data.my_elections; // Save to cache
            
            let optionsHTML = data.my_elections.map(e => `<option value="${e.election_id}">${escapeHtml(e.title)} (ID: ${e.election_id})</option>`).join("");
            if(optionsHTML === "") optionsHTML = `<option value="">No elections assigned to you yet</option>`;

            if(phaseSelect) {
                phaseSelect.innerHTML = optionsHTML;
                syncPhaseDropdown(); // Set to correct phase on load
                phaseSelect.addEventListener("change", syncPhaseDropdown); // Update if you select a different election
            }
            if(posSelect) posSelect.innerHTML = optionsHTML;
            if(voterSelect) voterSelect.innerHTML = optionsHTML;
            if(scrutinySelect) {
                scrutinySelect.innerHTML = optionsHTML;
                if(data.my_elections.length > 0) fetchPendingCandidates(); 
            }
            if(data.my_elections.length > 0) fetchPendingVoters();
        }
    } catch (e) {}
}

// Automatically changes the dropdown to match the real database status
function syncPhaseDropdown() {
    const electionId = document.getElementById("phaseElectionId").value;
    const statusSelect = document.getElementById("phaseSelect");
    if (!electionId || !statusSelect) return;
    
    const selectedElection = myElectionsCache.find(e => e.election_id == electionId);
    if (selectedElection && selectedElection.status) {
        statusSelect.value = selectedElection.status; 
    }
}

async function createElection() {
    const orgId = document.getElementById("electionOrgId").value.trim();
    const title = document.getElementById("electionTitle").value.trim();
    const description = document.getElementById("electionDescription").value.trim();
    const msg = document.getElementById("adminMessage");

    msg.style.display = "block"; msg.style.backgroundColor = "#f39c12"; msg.innerText = "Creating election...";
    if (!title || !description || !orgId) { msg.style.backgroundColor = "#e74c3c"; msg.innerText = "All fields required."; return; }

    try {
        const response = await fetch(`${API_URL}/api/admin/elections`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orgid: orgId, title: title, description: description })
        });
        const data = await response.json();
        if (response.ok) {
            msg.style.backgroundColor = "#2ecc71"; msg.innerText = data.message;
            document.getElementById("electionOrgId").value = ""; document.getElementById("electionTitle").value = ""; document.getElementById("electionDescription").value = "";
            loadSuperAdminElections(); // Refresh dropdown list
        } else { msg.style.backgroundColor = "#e74c3c"; msg.innerText = data.error; }
    } catch (e) { msg.style.backgroundColor = "#e74c3c"; msg.innerText = "Connection error."; }
}

async function loadPendingOrganizers() {
    const container = document.getElementById("pendingOrganizersContainer");
    if (!container) return;
    container.innerHTML = "Loading applications...";
    try {
        const response = await fetch(`${API_URL}/api/admin/pending-organizers`, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) return;
        
        if (data.pending_organizers && data.pending_organizers.length > 0) {
            let html = "";
            data.pending_organizers.forEach(app => {
                html += `<div style="padding: 10px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center;">
                    <div><strong>${escapeHtml(app.user_name)}</strong> applied to organize<br><small>Election: <strong>${escapeHtml(app.election_title)}</strong></small></div>
                    <button onclick="approveOrganizer(${app.app_id})" style="background-color: #2ecc71; padding: 5px 15px; color: white; border: none; border-radius: 4px; cursor: pointer;">Appoint Organizer</button>
                </div>`;
            });
            container.innerHTML = html;
        } else { container.innerHTML = "<p style='color: #7f8c8d; margin: 0;'>No pending Organizer applications.</p>"; }
    } catch (e) {}
}

async function approveOrganizer(appId) {
    if (!confirm(`Appoint this user as the Election Organizer?`)) return;
    try {
        const response = await fetch(`${API_URL}/api/admin/approve-organizer/${appId}`, { method: "POST", credentials: "include" });
        const data = await response.json();
        alert(response.ok ? data.message : data.error);
        loadPendingOrganizers(); 
    } catch (e) { alert("Connection error."); }
}

async function changeElectionPhase() {
    const electionId = document.getElementById("phaseElectionId").value;
    const status = document.getElementById("phaseSelect").value;
    if (!electionId) { alert("Please select an Election."); return; }
    try {
        const response = await fetch(`${API_URL}/api/admin/elections/${electionId}/status`, {
            method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: status })
        });
        const data = await response.json();
        alert(response.ok ? data.message : data.error);
        if (response.ok) {
            // Update the cache so it stays synced without refreshing the page
            const elec = myElectionsCache.find(e => e.election_id == electionId);
            if(elec) elec.status = status;
        }
    } catch (e) { alert("Connection error."); }
}

async function addElectionPosition() {
    const electionId = document.getElementById("positionElectionId").value;
    const title = document.getElementById("positionTitle").value.trim();
    if (!electionId || !title) { alert("Please select an election and enter a position title."); return; }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/elections/${electionId}/positions`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: title })
        });
        const data = await response.json();
        alert(response.ok ? data.message : data.error);
        if (response.ok) document.getElementById("positionTitle").value = "";
    } catch (e) { alert("Connection error."); }
}

async function fetchPendingVoters() {
    const electionId = document.getElementById("voterRollElectionId").value;
    const container = document.getElementById("voterRollContainer");
    if (!electionId) return;
    
    container.innerHTML = "Fetching pending voter applications...";
    try {
        const response = await fetch(`${API_URL}/api/admin/elections/${electionId}/pending-voters`, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) return;
        
        let html = "";
        if (data.pending_voters && data.pending_voters.length > 0) {
            data.pending_voters.forEach(v => {
                html += `<div style="padding: 10px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${escapeHtml(v.name)}</strong> (PID: ${v.pid})<br>
                        <small>${escapeHtml(v.email)}</small>
                    </div>
                    <button onclick="approveVoter(${electionId}, ${v.pid})" style="background-color: #2ecc71; padding: 5px 15px; width: auto; color: white; border: none; border-radius: 4px; cursor: pointer;">Approve Voter</button>
                </div>`;
            });
            container.innerHTML = html;
        } else {
            container.innerHTML = "<p style='color: #7f8c8d; margin: 0;'>No pending voter requests.</p>";
        }
    } catch (e) {}
}

async function approveVoter(electionId, pid) {
    if (!confirm(`Whitelist this user to vote in the election?`)) return;
    try {
        const response = await fetch(`${API_URL}/api/admin/elections/${electionId}/approve-voter`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pid: parseInt(pid) })
        });
        const data = await response.json();
        alert(response.ok ? data.message : data.error);
        fetchPendingVoters(); 
    } catch (e) { alert("Connection error."); }
}

async function fetchPendingCandidates() {
    const electionId = document.getElementById("scrutinyElectionId").value;
    const container = document.getElementById("scrutinyContainer");
    if (!electionId) { container.innerHTML = "<p style='color: red;'>Please select an Election.</p>"; return; }
    
    container.innerHTML = "Fetching pending records...";
    try {
        const partyRes = await fetch(`${API_URL}/api/admin/elections/${electionId}/pending-parties`, { credentials: "include" });
        const candRes = await fetch(`${API_URL}/api/admin/elections/${electionId}/pending-candidates`, { credentials: "include" });
        const partyData = await partyRes.json();
        const candData = await candRes.json();
        
        let html = "";
        if (partyData.pending_parties && partyData.pending_parties.length > 0) {
            html += `<h4 style="margin: 0 0 10px 0; color: #f39c12; font-family: monospace;">PENDING PARTIES</h4>`;
            partyData.pending_parties.forEach(p => {
                html += `<div style="padding: 10px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; background: #fffdfaa3;">
                    <div><strong>${escapeHtml(p.party_name)}</strong><br><small>Leader: ${escapeHtml(p.leader_name)}</small></div>
                    <button onclick="approveElectionParty(${p.party_id})" style="background-color: #f39c12; padding: 5px 15px; color: white; border: none; border-radius: 4px; cursor: pointer;">Approve Party</button>
                </div>`;
            });
        }
        
        if (candData.pending_candidates && candData.pending_candidates.length > 0) {
            html += `<h4 style="margin: 15px 0 10px 0; color: #2ecc71; font-family: monospace;">PENDING TICKETS</h4>`;
            candData.pending_candidates.forEach(cand => {
                html += `<div style="padding: 10px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center;">
                    <div><strong>${escapeHtml(cand.name)}</strong> (Ticket ID: ${cand.candidate_id})<br><small>Nominated for: <strong>${escapeHtml(cand.position)}</strong></small><br><small>Manifesto: <i>${escapeHtml(cand.manifesto)}</i></small></div>
                    <button onclick="approveSingleCandidate(${cand.candidate_id})" style="background-color: #2ecc71; padding: 5px 15px; color: white; border: none; border-radius: 4px; cursor: pointer;">Validate Ticket</button>
                </div>`;
            });
        }
        if (html === "") html = "<p style='color: #7f8c8d; margin: 0;'>No pending parties or tickets.</p>";
        container.innerHTML = html;
    } catch (e) {}
}

async function approveElectionParty(partyId) {
    if (!confirm(`Approve this Political Party for the election?`)) return;
    try {
        const response = await fetch(`${API_URL}/api/admin/parties/${partyId}/approve`, { method: "POST", credentials: "include" });
        const data = await response.json();
        alert(response.ok ? data.message : data.error);
        fetchPendingCandidates(); 
    } catch (e) { alert("Connection error."); }
}

async function approveSingleCandidate(candidateId) {
    if (!confirm(`Approve ticket ${candidateId} for the official ballot?`)) return;
    try {
        const response = await fetch(`${API_URL}/api/admin/candidates/${candidateId}/approve`, { method: "POST", credentials: "include" });
        const data = await response.json();
        alert(response.ok ? data.message : data.error);
        fetchPendingCandidates(); 
    } catch (e) { alert("Connection error."); }
}

async function loadAuditLogs(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "Retrieving immutable audit trail...";
    try {
        const response = await fetch(`${API_URL}/api/admin/audit-logs`, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) return;
        if (!data.audit_logs || data.audit_logs.length === 0) { 
            container.innerHTML = "<p style='color: #7f8c8d; margin: 0;'>No audit logs found.</p>"; 
            return; 
        }

        let html = '<table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 14px;">';
        html += '<tr style="border-bottom: 2px solid #ccc;"><th>ID</th><th>User</th><th>Action</th><th>Details</th><th>Time</th></tr>';
        data.audit_logs.forEach(log => {
            html += `<tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 8px;">${log.log_id}</td>
                <td style="padding: 8px;">${escapeHtml(log.user_name)}</td>
                <td style="padding: 8px;"><strong style="color: #6366f1;">${escapeHtml(log.action_type)}</strong></td>
                <td style="padding: 8px; color: #475569;">${escapeHtml(log.details || "—")}</td>
                <td style="padding: 8px;">${escapeHtml(log.action_time)}</td>
            </tr>`;
        });
        html += '</table>';
        container.innerHTML = html;
    } catch (error) {}
}

async function loadFraudLogs(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "Loading fraud logs...";
    try {
        const response = await fetch(`${API_URL}/api/admin/fraud-logs`, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) return;
        if (!data.fraud_logs || data.fraud_logs.length === 0) { 
            container.innerHTML = "<p style='color: #7f8c8d; margin: 0;'>No fraud alerts found.</p>"; 
            return; 
        }

        let html = '<table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 14px;">';
        html += '<tr style="border-bottom: 2px solid #ccc;"><th>ID</th><th>User</th><th>Fraud Type</th><th>Details</th><th>Time</th></tr>';
        data.fraud_logs.forEach(log => {
            html += `<tr class="fraud-log-row" style="border-bottom: 1px solid #ddd;">
                <td style="padding: 8px;">${log.fraud_id}</td>
                <td style="padding: 8px;">${escapeHtml(log.user_name)}</td>
                <td style="padding: 8px;"><strong style="color: #e74c3c;">${escapeHtml(log.fraud_type)}</strong></td>
                <td style="padding: 8px; color: #475569;">${escapeHtml(log.description || "—")}</td>
                <td style="padding: 8px;">${escapeHtml(log.detected_at)}</td>
            </tr>`;
        });
        html += '</table>';
        container.innerHTML = html;
    } catch (error) {}
}

// ============================================================
// PDF EXPORT FUNCTIONALITY
// ============================================================
function exportFraudLog() {
    const electionId = document.getElementById('exportElectionId').value;
    if (!electionId) {
        alert("Please select an election from the dropdown.");
        return;
    }
    window.location.href = `${API_URL}/api/admin/elections/${electionId}/export-fraud-log`;
}