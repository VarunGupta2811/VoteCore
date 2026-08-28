const API_URL = "http://127.0.0.1:5000";

// ============================================================
// UI TOGGLE & LOGIN STATUS
// ============================================================

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
    const user = await refreshUserFromBackend();
    if (user) {
        if (user.is_super_admin || user.is_organizer) {
            window.location.href = "admin.html";
        } else {
            window.location.href = "dashboard.html";
        }
    }
}

// ============================================================
// USER MANAGEMENT
// ============================================================

function getCurrentUser() {
    const savedUser = localStorage.getItem("votingUser");
    if (!savedUser) return null;
    try {
        return JSON.parse(savedUser);
    } catch (error) {
        return null;
    }
}

function saveCurrentUser(user) {
    if (!user) return;
    localStorage.setItem("votingUser", JSON.stringify(user));
}

function displayWelcome() {
    const welcome = document.getElementById("welcome");
    if (!welcome) return;

    const user = getCurrentUser();
    if (!user) {
        welcome.innerText = "Welcome!";
        return;
    }

    const firstName = user.first_name || "";
    const lastName = user.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim();

    if (fullName) {
        welcome.innerText = `Welcome, ${fullName}!`;
    } else if (user.email) {
        welcome.innerText = `Welcome, ${user.email}!`;
    } else {
        welcome.innerText = "Welcome!";
    }
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
            saveCurrentUser(data.user);
            return data.user;
        }
        return getCurrentUser();
    } catch (error) {
        return getCurrentUser();
    }
}

// ============================================================
// REGISTER (WITH GOV ID VERIFICATION)
// ============================================================

async function registerUser() {
    const firstName = document.getElementById("regFirstName").value.trim();
    const middleName = document.getElementById("regMiddleName").value.trim();
    const lastName = document.getElementById("regLastName").value.trim();
    const mobile = document.getElementById("regMobile").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const country = document.getElementById("regCountry").value.trim();
    const state = document.getElementById("regState").value.trim();
    const password = document.getElementById("regPassword").value;
    const confirmPassword = document.getElementById("regConfirmPassword").value;
    const dob = document.getElementById("regDob").value;
    const aadhaar = document.getElementById("regAadhaar").value.trim();
    const voterId = document.getElementById("regVoterId").value.trim().toUpperCase();
    
    const messageElement = document.getElementById("regMessage");
    messageElement.style.display = "block";
    messageElement.style.color = "white";

    if (!firstName || !lastName || !email || !mobile || !password || !confirmPassword || !dob || !aadhaar || !voterId) {
        messageElement.style.backgroundColor = "#e74c3c";
        messageElement.innerText = "All fields marked with * are required.";
        return;
    }

    if (password !== confirmPassword) {
        messageElement.style.backgroundColor = "#e74c3c";
        messageElement.innerText = "Passwords do not match.";
        return;
    }

    const aadhaarRegex = /^\d{12}$/;
    if (!aadhaarRegex.test(aadhaar)) {
        messageElement.style.backgroundColor = "#e74c3c";
        messageElement.innerText = "Invalid format: 12-digit numeric ID required.";
        return;
    }

    const voterIdRegex = /^[a-zA-Z]{3}\d{7,10}$/;
    if (!voterIdRegex.test(voterId)) {
        messageElement.style.backgroundColor = "#e74c3c";
        messageElement.innerText = "Invalid format: Voter ID usually starts with 3 letters followed by numbers.";
        return;
    }

    const dobDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - dobDate.getFullYear();
    const monthDifference = today.getMonth() - dobDate.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dobDate.getDate())) {
        age--;
    }

    if (age < 18) {
        messageElement.style.backgroundColor = "#e74c3c";
        messageElement.innerText = `Registration Denied: You are ${age} years old. You must be 18+ to register.`;
        return;
    }

    messageElement.style.backgroundColor = "#f39c12"; 
    messageElement.innerText = "Verifying Identity and Registering...";

    try {
        const response = await fetch(`${API_URL}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                first_name: firstName, middle_name: middleName, last_name: lastName,
                mobile: mobile, email: email, country: country, state: state,
                password: password, dob: dob, aadhaar: aadhaar, voter_id: voterId
            })
        });

        const data = await response.json();

        if (!response.ok) {
            messageElement.style.backgroundColor = "#e74c3c";
            messageElement.innerText = data.error || "Registration failed.";
            return;
        }

        messageElement.style.backgroundColor = "#2ecc71";
        messageElement.innerText = "Registration successful! Redirecting to login...";
        setTimeout(() => { window.location.href = "index.html"; }, 2000);
    } catch (error) {
        messageElement.style.backgroundColor = "#e74c3c";
        messageElement.innerText = "Cannot connect to backend.";
    }
}

// ============================================================
// LOGIN & OTP VERIFICATION
// ============================================================

async function login() {
    const emailElement = document.getElementById("email");
    const passwordElement = document.getElementById("password");
    const messageElement = document.getElementById("message");

    const email = emailElement.value.trim();
    const password = passwordElement.value;

    if (!email || !password) {
        messageElement.innerText = "Please enter email and password.";
        return;
    }

    messageElement.style.color = "#333";
    messageElement.innerText = "Authenticating...";

    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, password: password })
        });

        const data = await response.json();

        if (!response.ok) {
            messageElement.style.color = "#e74c3c";
            messageElement.innerText = data.error || "Invalid email or password.";
            return;
        }

        if (data.requires_otp) {
            document.getElementById("loginForm").style.display = "none";
            document.getElementById("otpForm").style.display = "block";
            
            const otpMsg = document.getElementById("otpMessage");
            otpMsg.style.display = "block";
            otpMsg.style.backgroundColor = "#3498db";
            otpMsg.style.color = "white";
            otpMsg.innerText = "OTP Sent to email! (Check server terminal if email fails)";
        }
    } catch (error) {
        messageElement.style.color = "#e74c3c";
        messageElement.innerText = "Cannot connect to backend.";
    }
}

async function verifyOTP() {
    const otpCode = document.getElementById("otpCode").value.trim();
    const messageElement = document.getElementById("otpMessage");

    if (!otpCode || otpCode.length !== 6) {
        messageElement.style.backgroundColor = "#e74c3c";
        messageElement.innerText = "Please enter a valid 6-digit OTP.";
        return;
    }

    messageElement.style.backgroundColor = "#f39c12";
    messageElement.innerText = "Verifying...";

    try {
        const response = await fetch(`${API_URL}/api/auth/verify-otp`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ otp: otpCode })
        });

        const data = await response.json();

        if (!response.ok) {
            messageElement.style.backgroundColor = "#e74c3c";
            messageElement.innerText = data.error || "Invalid OTP.";
            return;
        }

        if (data.user) saveCurrentUser(data.user);

        messageElement.style.backgroundColor = "#2ecc71";
        messageElement.innerText = "Login Verified! Redirecting...";
        
        setTimeout(function () {
            if (data.user && (data.user.is_super_admin || data.user.is_organizer)) {
                window.location.href = "admin.html";
            } else {
                window.location.href = "dashboard.html";
            }
        }, 1000);
    } catch (error) {
        messageElement.style.backgroundColor = "#e74c3c";
        messageElement.innerText = "Cannot connect to backend.";
    }
}

// ============================================================
// LOGOUT
// ============================================================

async function logout() {
    try {
        await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch (error) {}
    localStorage.removeItem("votingUser");
    window.location.href = "index.html";
}

// ============================================================
// PROFILE MANAGEMENT
// ============================================================

async function loadProfile() {
    try {
        const response = await fetch(`${API_URL}/api/auth/profile`, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) {
            window.location.href = "index.html";
            return;
        }

        const p = data.profile;
        document.getElementById("profMobile").value = p.mobile || "";
        document.getElementById("profCountry").value = p.country || "";
        document.getElementById("profState").value = p.state || "";
        
        document.getElementById("profVoterId").innerText = p.voter_id;
        document.getElementById("profAadhaar").innerText = p.aadhaar;
        document.getElementById("profStatus").innerText = p.is_verified ? "✅ Verified & Locked" : "❌ Unverified";

        const orgsList = document.getElementById("profOrgs");
        orgsList.innerHTML = "";
        if (p.organizations.length === 0) {
            orgsList.innerHTML = "<li style='list-style: none; margin-left: -20px; color: #7f8c8d;'>No organizations joined yet.</li>";
        } else {
            p.organizations.forEach(org => {
                const li = document.createElement("li");
                li.innerHTML = `<strong>${escapeHtml(org.org_name)}</strong> (Role: ${escapeHtml(org.role)})`;
                orgsList.appendChild(li);
            });
        }
    } catch (e) {
        console.error("Profile Error:", e);
    }
}

async function updateProfile() {
    const mobile = document.getElementById("profMobile").value.trim();
    const country = document.getElementById("profCountry").value.trim();
    const state = document.getElementById("profState").value.trim();
    const msg = document.getElementById("profMessage");

    msg.style.display = "block";
    msg.style.backgroundColor = "#f39c12";
    msg.style.color = "white";
    msg.innerText = "Updating...";

    try {
        const response = await fetch(`${API_URL}/api/auth/profile`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mobile: mobile, country: country, state: state })
        });
        const data = await response.json();
        
        if (response.ok) {
            msg.style.backgroundColor = "#2ecc71";
            msg.innerText = "Profile updated successfully!";
        } else {
            msg.style.backgroundColor = "#e74c3c";
            msg.innerText = data.error;
        }
    } catch (e) {
        msg.style.backgroundColor = "#e74c3c";
        msg.innerText = "Error updating profile.";
    }
}

// ============================================================
// DASHBOARD & NAVIGATION
// ============================================================

async function loadDashboard() {
    displayWelcome();
    const user = await refreshUserFromBackend();
    if (!user) {
        window.location.href = "index.html";
        return;
    }

    if (user.is_super_admin) {
        const superBtn = document.getElementById("superAdminBtnContainer");
        if (superBtn) superBtn.style.display = "block";
    }
    if (user.is_organizer) {
        const orgBtn = document.getElementById("organizerBtnContainer");
        if (orgBtn) orgBtn.style.display = "block";
    }

    const electionsElement = document.getElementById("elections");
    if (!electionsElement) return;
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
            div.innerHTML = `
                <h3>${escapeHtml(election.title)}</h3>
                <p>${escapeHtml(election.description || "")}</p>
                <p><strong style="color: ${phaseColor};">Phase: ${escapeHtml(election.status)}</strong></p>
                <button onclick="viewElection(${election.election_id})">View Election</button>
                <button onclick="viewResults(${election.election_id})" style="margin-top: 10px;">View Results</button>
                <button onclick="selfNominate(${election.election_id})" style="margin-top: 10px; background-color: #9b59b6;">Run as Candidate</button>
            `;
            electionsElement.appendChild(div);
        });
    } catch (error) {
        electionsElement.innerText = "Cannot connect to backend.";
    }
}

function viewElection(electionId) { window.location.href = `election.html?id=${electionId}`; }
function viewResults(electionId) { window.location.href = `results.html?id=${electionId}`; }

// ============================================================
// ELECTION & VOTING LOGIC
// ============================================================

async function loadElection() {
    displayWelcome();
    const user = await refreshUserFromBackend();
    if (!user) { window.location.href = "index.html"; return; }

    const params = new URLSearchParams(window.location.search);
    const electionId = params.get("id");
    const title = document.getElementById("electionTitle");
    const description = document.getElementById("electionDescription");
    const status = document.getElementById("electionStatus");
    const candidatesElement = document.getElementById("candidates");

    try {
        const electionResponse = await fetch(`${API_URL}/api/elections/${electionId}`, { method: "GET", credentials: "include" });
        const electionData = await electionResponse.json();
        if (!electionResponse.ok) { title.innerText = "Unable to load election."; return; }

        const election = electionData.election;
        title.innerText = election.title || "";
        description.innerText = election.description || "";
        status.innerText = `Phase: ${election.status || ""}`;

        candidatesElement.innerText = "Loading official candidates...";
        const candidateResponse = await fetch(`${API_URL}/api/elections/${electionId}/candidates`, { method: "GET", credentials: "include" });
        const candidateData = await candidateResponse.json();

        const candidates = candidateData.candidates || [];
        if (candidates.length === 0) { candidatesElement.innerText = "No candidates approved for this election yet."; return; }

        candidatesElement.innerHTML = "";
        candidates.forEach(function (candidate) {
            const div = document.createElement("div");
            div.className = "candidate-card";
            div.innerHTML = `
                <h3>${escapeHtml(candidate.name)}</h3>
                <p><strong>Position:</strong> ${escapeHtml(candidate.position)}</p>
                <p><strong>Manifesto:</strong> ${escapeHtml(candidate.manifesto || "")}</p>
                <button class="vote-button" onclick="castVote(${electionId}, ${candidate.candidate_id})">Vote for ${escapeHtml(candidate.name)}</button>
            `;
            candidatesElement.appendChild(div);
        });
    } catch (error) {
        candidatesElement.innerText = "Cannot connect to backend.";
    }
}

async function castVote(electionId, candidateId) {
    const confirmed = confirm("Are you sure you want to securely cast your vote for this candidate?");
    if (!confirmed) return;
    const buttons = document.querySelectorAll(".vote-button");
    buttons.forEach(function (button) { button.disabled = true; });

    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/vote`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidate_id: candidateId })
        });
        const data = await response.json();
        
        if (response.ok) {
            alert(data.message || "Ballot cryptographically sealed and cast!");
            buttons.forEach(function (button) { button.innerText = "Vote already cast"; });
            return;
        }
        alert(data.error || "Unable to cast vote.");
        buttons.forEach(function (button) { button.disabled = false; });
    } catch (error) {
        alert("Cannot connect to backend.");
        buttons.forEach(function (button) { button.disabled = false; });
    }
}

async function loadResults() {
    displayWelcome();
    const params = new URLSearchParams(window.location.search);
    const electionId = params.get("id");
    const resultsElement = document.getElementById("results");
    if (!resultsElement) return;

    resultsElement.innerText = "Loading results...";
    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/results`, { method: "GET", credentials: "include" });
        const data = await response.json();
        
        const results = data.results || [];
        if (results.length === 0) { resultsElement.innerText = "No results available yet."; return; }
        
        resultsElement.innerHTML = "";
        results.forEach(function(result) {
            const div = document.createElement("div");
            div.className = "candidate-card";
            div.innerHTML = `
                <h3>${escapeHtml(result.candidate_name)}</h3>
                <p><strong>Position:</strong> ${escapeHtml(result.position)}</p>
                <p><strong>Total Votes:</strong> ${result.total_votes}</p>
            `;
            resultsElement.appendChild(div);
        });
    } catch (error) {
        resultsElement.innerText = "Cannot connect to backend.";
    }
}

// ============================================================
// SELF NOMINATION & ORG REQUESTS
// ============================================================

async function selfNominate(electionId) {
    const position = prompt("What position are you running for? (e.g., President)");
    if (!position) return;
    const manifesto = prompt("Enter a short manifesto or campaign slogan:");
    
    try {
        const response = await fetch(`${API_URL}/api/elections/${electionId}/self-nominate`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ position: position, manifesto: manifesto || "No manifesto provided." })
        });
        const data = await response.json();
        if (response.ok) { alert(data.message); } 
        else { alert("Error: " + data.error); }
    } catch (e) { alert("Cannot connect to backend."); }
}

async function requestNewOrg() {
    const orgId = document.getElementById("newOrgId").value.trim();
    const orgName = document.getElementById("newOrgName").value.trim();
    const orgEmail = document.getElementById("newOrgEmail").value.trim();
    const msg = document.getElementById("orgMessage");

    msg.style.display = "block";
    msg.style.backgroundColor = "#f39c12";
    msg.innerText = "Sealing organization request...";

    if (!orgId || !orgName || !orgEmail) {
        msg.style.backgroundColor = "#e74c3c";
        msg.innerText = "All fields are required.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/organizations/request`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orgid: orgId, org_name: orgName, org_email: orgEmail })
        });
        const data = await response.json();
        
        if (response.ok) {
            msg.style.backgroundColor = "#2ecc71";
            msg.innerText = data.message;
            document.getElementById("newOrgId").value = "";
            document.getElementById("newOrgName").value = "";
            document.getElementById("newOrgEmail").value = "";
        } else {
            msg.style.backgroundColor = "#e74c3c";
            msg.innerText = data.error;
        }
    } catch (e) {
        msg.style.backgroundColor = "#e74c3c";
        msg.innerText = "Connection error.";
    }
}

// ============================================================
// ADMIN UI ROUTING & ELECTION PHASES
// ============================================================

async function loadAdminUI() {
    const user = await refreshUserFromBackend();
    if (!user) {
        window.location.href = "index.html";
        return;
    }
    
    if (!user.is_super_admin && !user.is_organizer) {
        window.location.href = "dashboard.html";
        return;
    }

    if (user.is_super_admin) {
        const sAdmin = document.getElementById("superAdminSection");
        if(sAdmin) {
            sAdmin.style.display = "block";
            loadPendingOrgs();
        }
    }
    
    if (user.is_organizer) {
        const orgAdmin = document.getElementById("organizerSection");
        if(orgAdmin) {
            orgAdmin.style.display = "block";
        }
    }
}

async function createElection() {
    const title = document.getElementById("electionTitle").value.trim();
    const description = document.getElementById("electionDescription").value.trim();
    const orgId = document.getElementById("electionOrgId").value.trim();
    const msg = document.getElementById("adminMessage");

    msg.style.display = "block";
    msg.style.backgroundColor = "#f39c12"; 
    msg.innerText = "Creating election...";

    if (!title || !description || !orgId) {
        msg.style.backgroundColor = "#e74c3c"; 
        msg.innerText = "Organization ID, title, and description are required.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/admin/elections`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orgid: orgId, title: title, description: description })
        });
        const data = await response.json();
        
        if (response.ok) {
            msg.style.backgroundColor = "#2ecc71";
            msg.innerText = data.message;
            document.getElementById("electionTitle").value = "";
            document.getElementById("electionDescription").value = "";
        } else {
            msg.style.backgroundColor = "#e74c3c";
            msg.innerText = data.error;
        }
    } catch (e) {
        msg.style.backgroundColor = "#e74c3c";
        msg.innerText = "Connection error.";
    }
}

async function changeElectionPhase() {
    const electionId = document.getElementById("phaseElectionId").value.trim();
    const status = document.getElementById("phaseSelect").value;
    
    if (!electionId) { alert("Please enter an Election ID."); return; }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/elections/${electionId}/status`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: status })
        });
        const data = await response.json();
        alert(response.ok ? data.message : data.error);
    } catch (e) {
        alert("Connection error.");
    }
}

async function fetchPendingCandidates() {
    const electionId = document.getElementById("scrutinyElectionId").value.trim();
    const container = document.getElementById("scrutinyContainer");
    
    if (!electionId) { container.innerHTML = "<p style='color: red;'>Please enter an Election ID.</p>"; return; }
    
    container.innerHTML = "Loading candidates...";
    try {
        const response = await fetch(`${API_URL}/api/admin/elections/${electionId}/pending-candidates`, { credentials: "include" });
        const data = await response.json();
        
        if (!response.ok) { container.innerHTML = `<p style="color: red;">${data.error}</p>`; return; }
        
        if (data.pending_candidates && data.pending_candidates.length > 0) {
            let html = "";
            data.pending_candidates.forEach(cand => {
                html += `<div style="padding: 10px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${escapeHtml(cand.name)}</strong> (ID: ${cand.candidate_id})<br>
                        <small>Position: ${escapeHtml(cand.position)}</small>
                    </div>
                    <button onclick="approveSingleCandidate(${cand.candidate_id})" style="background-color: #2ecc71; padding: 5px 15px; width: auto;">Approve</button>
                </div>`;
            });
            container.innerHTML = html;
        } else {
            container.innerHTML = "<p style='color: #7f8c8d; margin: 0;'>No pending candidates for this election.</p>";
        }
    } catch (e) {
        container.innerHTML = "<p style='color: #e74c3c;'>Error loading candidates.</p>";
    }
}

async function approveSingleCandidate(candidateId) {
    if (!confirm(`Approve candidate ${candidateId} and add them to the official ballot?`)) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/candidates/${candidateId}/approve`, {
            method: "POST",
            credentials: "include"
        });
        const data = await response.json();
        alert(response.ok ? data.message : data.error);
        fetchPendingCandidates(); 
    } catch (e) {
        alert("Connection error.");
    }
}

async function addOrgMember() {
    const orgId = document.getElementById("memberOrgId").value.trim();
    const pid = document.getElementById("memberPid").value.trim();
    const role = document.getElementById("memberRole").value;
    const msg = document.getElementById("memberMessage");

    msg.style.display = "block";
    msg.style.backgroundColor = "#34495e";
    msg.innerText = "Adding member...";

    if (!orgId || !pid) {
        msg.style.backgroundColor = "#e74c3c";
        msg.innerText = "Organization ID and User PID are required.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/admin/members`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orgid: orgId, member_pid: parseInt(pid), role_name: role })
        });
        const data = await response.json();
        if (response.ok) {
            msg.style.backgroundColor = "#2ecc71";
            msg.innerText = data.message;
            document.getElementById("memberPid").value = "";
        } else {
            msg.style.backgroundColor = "#e74c3c";
            msg.innerText = data.error;
        }
    } catch (e) {
        msg.style.backgroundColor = "#e74c3c";
        msg.innerText = "Connection error.";
    }
}

async function loadPendingOrgs() {
    const container = document.getElementById("pendingOrgsContainer");
    if (!container) return;
    
    container.innerHTML = "Loading...";
    try {
        const response = await fetch(`${API_URL}/api/admin/pending-orgs`, { credentials: "include" });
        const data = await response.json();
        
        if (data.pending_orgs && data.pending_orgs.length > 0) {
            let html = "";
            data.pending_orgs.forEach(org => {
                html += `<div style="padding: 10px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${escapeHtml(org.org_name)}</strong> (${escapeHtml(org.orgid)})<br>
                        <small>${escapeHtml(org.org_email)}</small>
                    </div>
                    <button onclick="approveOrg('${org.orgid}')" style="background-color: #2ecc71; padding: 5px 15px; width: auto;">Approve</button>
                </div>`;
            });
            container.innerHTML = html;
        } else {
            container.innerHTML = "<p style='color: #7f8c8d; margin: 0;'>No pending requests found.</p>";
        }
    } catch (e) {
        container.innerHTML = "<p style='color: #e74c3c;'>Error loading requests.</p>";
    }
}

async function approveOrg(orgid) {
    if (!confirm(`Are you sure you want to approve and activate ${orgid}?`)) return;
    try {
        const response = await fetch(`${API_URL}/api/admin/approve-org/${orgid}`, {
            method: "POST",
            credentials: "include"
        });
        const data = await response.json();
        if (response.ok) {
            alert(data.message);
            loadPendingOrgs(); 
        } else {
            alert(data.error);
        }
    } catch (e) {
        alert("Connection error.");
    }
}

async function loadAuditLogs() {
    const container = document.getElementById("logsContainer");
    container.innerHTML = "Retrieving immutable audit trail...";
    try {
        const response = await fetch(`${API_URL}/api/admin/audit-logs`, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) { container.innerHTML = `<p style="color: red;">${data.error}</p>`; return; }
        let html = '<table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 14px;">';
        html += '<tr style="border-bottom: 2px solid #ccc;"><th>ID</th><th>User</th><th>Action</th><th>Time</th></tr>';
        data.audit_logs.forEach(log => {
            html += `<tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 8px;">${log.log_id}</td>
                <td style="padding: 8px;">${escapeHtml(log.user_name)}</td>
                <td style="padding: 8px;"><strong>${escapeHtml(log.action_type)}</strong></td>
                <td style="padding: 8px;">${escapeHtml(log.action_time)}</td>
            </tr>`;
        });
        html += '</table>';
        container.innerHTML = html;
    } catch (error) { container.innerHTML = "<p style='color: red;'>Failed to fetch logs.</p>"; }
}

async function loadFraudLogs() {
    const container = document.getElementById("logsContainer");
    container.innerHTML = "Loading fraud logs...";
    try {
        const response = await fetch(`${API_URL}/api/admin/fraud-logs`, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) { container.innerHTML = `<p style="color: red;">${data.error}</p>`; return; }
        let html = '<table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 14px;">';
        html += '<tr style="border-bottom: 2px solid #ccc;"><th>ID</th><th>User</th><th>Fraud Type</th><th>Time</th></tr>';
        data.fraud_logs.forEach(log => {
            html += `<tr style="border-bottom: 1px solid #ddd; color: #c0392b;">
                <td style="padding: 8px;">${log.fraud_id}</td>
                <td style="padding: 8px;">${escapeHtml(log.user_name)}</td>
                <td style="padding: 8px;"><strong>${escapeHtml(log.fraud_type)}</strong></td>
                <td style="padding: 8px;">${escapeHtml(log.detected_at)}</td>
            </tr>`;
        });
        html += '</table>';
        container.innerHTML = html;
    } catch (error) { container.innerHTML = "<p style='color: red;'>Failed to fetch logs.</p>"; }
}