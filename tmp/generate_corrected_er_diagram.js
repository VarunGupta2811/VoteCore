const fs = require('fs');
const { instance } = require('@viz-js/viz');

const output = 'output/erd/online-voting-system-er-diagram-corrected.svg';
const tables = {
  UACCOUNT: { group: 'auth', columns: [
    ['PK', 'PID'], ['', 'FIRST_NAME'], ['', 'LAST_NAME'], ['', 'MOBILE'], ['', 'EMAIL'], ['', 'PASSWORD_HASH'], ['', 'COUNTRY'], ['', 'STATE'], ['', 'IS_ACTIVE'], ['', 'CREATED_AT']
  ]},
  GOV_IDENTITY: { group: 'auth', columns: [['PK, FK', 'PID', 'UACCOUNT', 'PID'], ['', 'EPIC_ID'], ['', 'AADHAAR_NO'], ['', 'FULL_NAME'], ['', 'DOB'], ['', 'IS_VERIFIED']]},
  IDENTITY_WALLET: { group: 'auth', columns: [['PK', 'WALLET_ID'], ['FK', 'PID', 'UACCOUNT', 'PID'], ['', 'IDENTITY_TYPE'], ['', 'EPIC_ID'], ['', 'ADDED_AT']]},
  OTP_VERIFICATION: { group: 'auth', columns: [['PK', 'OTP_ID'], ['FK', 'PID', 'UACCOUNT', 'PID'], ['', 'OTP_CODE'], ['', 'OTP_CODE_HASH'], ['', 'EXPIRES_AT'], ['', 'VERIFIED'], ['', 'CREATED_AT']]},
  USER_SESSIONS: { group: 'auth', columns: [['PK', 'SESSION_ID'], ['FK', 'PID', 'UACCOUNT', 'PID'], ['', 'EXPIRES_AT'], ['', 'IS_ACTIVE'], ['', 'CREATED_AT']]},
  ELECTION_HOST_REQUEST: { group: 'paas', columns: [['PK', 'REQUEST_ID'], ['FK', 'REQUESTER_PID', 'UACCOUNT', 'PID'], ['', 'ORG_NAME'], ['', 'ELECTION_TITLE'], ['', 'DESCRIPTION'], ['', 'STATUS'], ['', 'SUBMITTED_AT']]},
  HOST_JURISDICTION: { group: 'paas', columns: [['PK', 'JURISDICTION_ID'], ['', 'NAME'], ['', 'WEBSITE_URL'], ['', 'CONTACT_EMAIL'], ['', 'IS_ACTIVE']]},
  POLITICAL_PARTY: { group: 'paas', columns: [['PK', 'PARTY_ID'], ['FK', 'FOUNDER_PID', 'UACCOUNT', 'PID'], ['', 'NAME'], ['', 'PARTY_SYMBOL_URL'], ['', 'IS_ACTIVE']]},
  ELECTION: { group: 'core', columns: [['PK', 'ELECTION_ID'], ['FK', 'JURISDICTION_ID', 'HOST_JURISDICTION', 'JURISDICTION_ID'], ['', 'TITLE'], ['', 'DESCRIPTION'], ['', 'STATUS'], ['', 'START_DATE'], ['', 'END_DATE'], ['FK', 'ORGANIZER_PID', 'UACCOUNT', 'PID'], ['', 'ORGANIZER_APPOINTED_AT'], ['', 'ORGANIZER_APPOINTED_BY']]},
  ELECTION_POSITION: { group: 'core', columns: [['PK', 'POSITION_ID'], ['FK', 'ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['', 'TITLE'], ['', 'DISPLAY_ORDER'], ['', 'STATUS']]},
  EVENT_PARTICIPANTS: { group: 'core', columns: [['PK, FK', 'ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['PK, FK', 'PID', 'UACCOUNT', 'PID'], ['', 'STATUS'], ['', 'REGISTERED_AT']]},
  ELECTION_PARTY: { group: 'nomination', columns: [['PK', 'ELECTION_PARTY_ID'], ['FK', 'ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['FK', 'PARTY_ID', 'POLITICAL_PARTY', 'PARTY_ID'], ['FK', 'CAMPAIGN_LEADER_PID', 'UACCOUNT', 'PID'], ['', 'STATUS'], ['', 'REVIEWED_AT'], ['', 'REVIEWED_BY']]},
  ELECTION_PARTY_MEMBER: { group: 'nomination', columns: [['PK, FK', 'ELECTION_PARTY_ID', 'ELECTION_PARTY', 'ELECTION_PARTY_ID'], ['PK, FK', 'PID', 'UACCOUNT', 'PID'], ['FK', 'ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['', 'MEMBER_ROLE'], ['', 'STATUS'], ['', 'JOINED_AT']]},
  CANDIDATE: { group: 'nomination', columns: [['PK', 'CANDIDATE_ID'], ['FK', 'ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['FK', 'PID', 'UACCOUNT', 'PID'], ['', 'POSITION'], ['FK', 'POSITION_ID', 'ELECTION_POSITION', 'POSITION_ID'], ['FK', 'ELECTION_PARTY_ID', 'ELECTION_PARTY', 'ELECTION_PARTY_ID'], ['', 'MANIFESTO'], ['', 'STATUS'], ['', 'ORGANIZER_APPROVED_AT'], ['', 'ORGANIZER_APPROVED_BY']]},
  VOTER_POST_STATUS: { group: 'voting', columns: [['PK, FK', 'ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['PK, FK', 'POSITION_ID', 'ELECTION_POSITION', 'POSITION_ID'], ['PK, FK', 'PID', 'UACCOUNT', 'PID'], ['', 'STATUS'], ['', 'VOTED_AT']]},
  VOTE: { group: 'voting', columns: [['PK', 'VOTE_ID'], ['FK', 'ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['FK', 'CANDIDATE_ID', 'CANDIDATE', 'CANDIDATE_ID'], ['FK', 'POSITION_ID', 'ELECTION_POSITION', 'POSITION_ID'], ['', 'VOTED_AT']]},
  AUDIT_LOGS: { group: 'security', columns: [['PK', 'LOG_ID'], ['FK', 'PID', 'UACCOUNT', 'PID'], ['', 'ACTION_TYPE'], ['', 'DETAILS'], ['', 'ACTION_TIME']]},
  FRAUD_LOGS: { group: 'security', columns: [['PK', 'FRAUD_ID'], ['FK', 'PID', 'UACCOUNT', 'PID'], ['FK', 'ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['', 'FRAUD_TYPE'], ['', 'DESCRIPTION'], ['', 'IP_ADDRESS'], ['', 'DETECTED_AT']]}
};

const groupSpecs = {
  auth: { label: 'AUTHENTICATION & IDENTITY', color: '#2563eb', fill: '#eff6ff' },
  paas: { label: 'PAAS PROVISIONING', color: '#16a34a', fill: '#f0fdf4' },
  core: { label: 'CORE ELECTION', color: '#9333ea', fill: '#faf5ff' },
  nomination: { label: 'NOMINATIONS & CAMPAIGN', color: '#d97706', fill: '#fffbeb' },
  voting: { label: 'DECOUPLED VOTING ENGINE', color: '#ef4444', fill: '#fff1f2' },
  security: { label: 'SYSTEM LOGGING & SECURITY', color: '#475569', fill: '#f8fafc' }
};
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const port = s => s.replaceAll(/[^A-Za-z0-9_]/g, '_');
const nodeLabel = (name, table, color) => {
  const rows = [`<TR><TD COLSPAN="2" BGCOLOR="${color}" ALIGN="CENTER"><FONT COLOR="#ffffff" FACE="Arial" POINT-SIZE="14"><B>${name}</B></FONT></TD></TR>`];
  table.columns.forEach(([kind, field, parent, parentField], i) => {
    const key = kind.includes('PK') ? 'PK' : kind.includes('FK') ? 'FK' : '';
    const keyColor = key === 'PK' ? '#854d0e' : key === 'FK' ? '#0f766e' : '#475569';
    const detail = parent ? `${field} → ${parent}.${parentField}` : field;
    const rowPort = parent ? ` PORT="fk_${i}"` : kind.includes('PK') ? ` PORT="pk_${port(field)}"` : '';
    rows.push(`<TR><TD${rowPort} ALIGN="CENTER" BGCOLOR="${key ? '#fef3c7' : '#ffffff'}"><FONT COLOR="${keyColor}" FACE="Arial" POINT-SIZE="10"><B>${key}</B></FONT></TD><TD ALIGN="LEFT"><FONT COLOR="#172033" FACE="Courier New" POINT-SIZE="10">${esc(detail)}</FONT></TD></TR>`);
  });
  return `<<TABLE BORDER="0" CELLBORDER="1" COLOR="#cbd5e1" CELLSPACING="0" CELLPADDING="5" BGCOLOR="#ffffff">${rows.join('')}</TABLE>>`;
};

const nodes = Object.entries(tables).map(([name, table]) => {
  const color = groupSpecs[table.group].color;
  return `"${name}" [label=${nodeLabel(name, table, color)}];`;
}).join('\n');

const clusters = Object.entries(groupSpecs).map(([group, spec]) => {
  const members = Object.entries(tables).filter(([, table]) => table.group === group).map(([name]) => `"${name}";`).join(' ');
  return `subgraph cluster_${group} { label="${spec.label}"; labelloc=t; labeljust=c; fontsize=18; fontname="Arial"; fontcolor="#172033"; color="${spec.color}"; penwidth=1.7; style="rounded,filled"; fillcolor="${spec.fill}"; margin=18; ${members} }`;
}).join('\n');

const relationships = [];
for (const [childName, table] of Object.entries(tables)) {
  table.columns.forEach(([kind, field, parentName, parentField], i) => {
    if (kind.includes('FK')) relationships.push({ childName, field, parentName, parentField, index: i });
  });
}
const edges = relationships.map(({ childName, field, parentName, parentField, index }) =>
  `"${childName}":fk_${index}:e -> "${parentName}":pk_${port(parentField)}:w [tooltip="${childName}.${field} → ${parentName}.${parentField}"];`
).join('\n');

const source = `digraph ER {
  graph [rankdir=LR, newrank=true, compound=true, bgcolor="#ffffff", pad="0.35", nodesep="0.52", ranksep="1.25", splines=polyline, overlap=false, outputorder=edgesfirst, concentrate=false, fontname="Arial", label="Online Voting System · Corrected Entity Relationship Diagram\\n18 tables · 30 declared foreign keys · arrows point from child FK to referenced parent PK", labelloc=t, labeljust=c, fontsize=22, fontcolor="#172033"];
  node [shape=plain, margin=0];
  edge [color="#0f766e", penwidth=1.45, arrowsize=0.7, arrowhead=normal];
  ${nodes}
  ${edges}
}`;

(async () => {
  const viz = await instance();
  const svg = viz.renderString(source, { format: 'svg', engine: 'fdp' });
  const edgeCount = (svg.match(/<g id="edge/g) || []).length;
  if (edgeCount !== 30) throw new Error(`Expected 30 FK relationships, rendered ${edgeCount}.`);
  fs.mkdirSync('output/erd', { recursive: true });
  fs.writeFileSync(output, svg);
  console.log(`Generated ${output}: 18 tables, ${edgeCount} FK relationships.`);
})();
