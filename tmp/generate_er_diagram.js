const fs = require('fs');
const { instance } = require('@viz-js/viz');

const out = 'tmp/votecore-er-diagram.svg';
const tables = {
  UACCOUNT: { pk: ['PID'], fk: [], other: 8 },
  GOV_IDENTITY: { pk: ['PID'], fk: [['PID', 'UACCOUNT', 'PID']], other: 5 },
  IDENTITY_WALLET: { pk: ['WALLET_ID'], fk: [['PID', 'UACCOUNT', 'PID']], other: 3 },
  OTP_VERIFICATION: { pk: ['OTP_ID'], fk: [['PID', 'UACCOUNT', 'PID']], other: 5 },
  USER_SESSIONS: { pk: ['SESSION_ID'], fk: [['PID', 'UACCOUNT', 'PID']], other: 3 },
  ELECTION_HOST_REQUEST: { pk: ['REQUEST_ID'], fk: [['REQUESTER_PID', 'UACCOUNT', 'PID']], other: 5 },
  HOST_JURISDICTION: { pk: ['JURISDICTION_ID'], fk: [], other: 4 },
  POLITICAL_PARTY: { pk: ['PARTY_ID'], fk: [['FOUNDER_PID', 'UACCOUNT', 'PID']], other: 3 },
  ELECTION: { pk: ['ELECTION_ID'], fk: [['JURISDICTION_ID', 'HOST_JURISDICTION', 'JURISDICTION_ID'], ['ORGANIZER_PID', 'UACCOUNT', 'PID']], other: 7 },
  ELECTION_POSITION: { pk: ['POSITION_ID'], fk: [['ELECTION_ID', 'ELECTION', 'ELECTION_ID']], other: 3 },
  EVENT_PARTICIPANTS: { pk: ['ELECTION_ID + PID'], fk: [['ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['PID', 'UACCOUNT', 'PID']], other: 2 },
  ELECTION_PARTY: { pk: ['ELECTION_PARTY_ID'], fk: [['ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['PARTY_ID', 'POLITICAL_PARTY', 'PARTY_ID'], ['CAMPAIGN_LEADER_PID', 'UACCOUNT', 'PID']], other: 3 },
  ELECTION_PARTY_MEMBER: { pk: ['ELECTION_PARTY_ID + PID'], fk: [['ELECTION_PARTY_ID', 'ELECTION_PARTY', 'ELECTION_PARTY_ID'], ['ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['PID', 'UACCOUNT', 'PID']], other: 3 },
  CANDIDATE: { pk: ['CANDIDATE_ID'], fk: [['ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['PID', 'UACCOUNT', 'PID'], ['POSITION_ID', 'ELECTION_POSITION', 'POSITION_ID'], ['ELECTION_PARTY_ID', 'ELECTION_PARTY', 'ELECTION_PARTY_ID']], other: 5 },
  VOTER_POST_STATUS: { pk: ['ELECTION_ID + POSITION_ID + PID'], fk: [['ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['POSITION_ID', 'ELECTION_POSITION', 'POSITION_ID'], ['PID', 'UACCOUNT', 'PID']], other: 2 },
  VOTE: { pk: ['VOTE_ID'], fk: [['ELECTION_ID', 'ELECTION', 'ELECTION_ID'], ['CANDIDATE_ID', 'CANDIDATE', 'CANDIDATE_ID'], ['POSITION_ID', 'ELECTION_POSITION', 'POSITION_ID']], other: 1 },
  AUDIT_LOGS: { pk: ['LOG_ID'], fk: [['PID', 'UACCOUNT', 'PID']], other: 3 },
  FRAUD_LOGS: { pk: ['FRAUD_ID'], fk: [['PID', 'UACCOUNT', 'PID'], ['ELECTION_ID', 'ELECTION', 'ELECTION_ID']], other: 4 }
};

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const port = value => value.replaceAll(/[^A-Za-z0-9_]/g, '_');
const label = (name, table) => {
  const rows = [
    `<TR><TD BGCOLOR="#5b4bc4" COLSPAN="2" ALIGN="LEFT"><FONT COLOR="#ffffff" FACE="Arial" POINT-SIZE="15"><B>${name}</B></FONT></TD></TR>`,
    ...table.pk.map(field => `<TR><TD PORT="pk_${port(field)}" ALIGN="LEFT"><FONT COLOR="#5b4bc4" FACE="Courier New" POINT-SIZE="11"><B>PK</B></FONT></TD><TD ALIGN="LEFT"><FONT COLOR="#18233d" FACE="Courier New" POINT-SIZE="11">${escape(field)}</FONT></TD></TR>`),
    ...table.fk.map(([field, parent, parentField], i) => `<TR><TD PORT="fk_${i}" ALIGN="LEFT"><FONT COLOR="#0f8c85" FACE="Courier New" POINT-SIZE="11"><B>FK</B></FONT></TD><TD ALIGN="LEFT"><FONT COLOR="#18233d" FACE="Courier New" POINT-SIZE="10">${escape(field)} → ${parent}.${parentField}</FONT></TD></TR>`),
    `<TR><TD COLSPAN="2" ALIGN="LEFT"><FONT COLOR="#64748b" FACE="Arial" POINT-SIZE="10">+ ${table.other} non-key column(s)</FONT></TD></TR>`
  ];
  return `<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="7" BGCOLOR="#f8fafc">${rows.join('')}</TABLE>>`;
};

const nodes = Object.entries(tables).map(([name, table]) => `"${name}" [label=${label(name, table)}];`).join('\n');
const edges = Object.entries(tables).flatMap(([childName, table]) => table.fk.map(([field, parentName, parentField], i) => `"${childName}":fk_${i}:e -> "${parentName}":pk_${port(parentField)}:w [tooltip="${childName}.${field} → ${parentName}.${parentField}"];`)).join('\n');
const source = `digraph ER {
  graph [rankdir=LR, bgcolor="#0f172a", pad="0.5", nodesep="0.8", ranksep="2.0", splines=ortho, overlap=false, outputorder=edgesfirst, concentrate=false, fontname="Arial", label="VoteCore V2 · Entity Relationship Diagram\\nPK = primary key   ·   FK = foreign key   ·   arrows point from child FK to referenced parent PK", labelloc=t, labeljust=l, fontsize=24, fontcolor="#f8fafc"];
  node [shape=plain, margin=0];
  edge [color="#14b8a6", penwidth=1.8, arrowsize=0.75, arrowhead=normal];
  ${nodes}
  ${edges}
}`;

(async () => {
  const viz = await instance();
  const svg = viz.renderString(source, { format: 'svg', engine: 'dot' });
  if (!svg.includes('UACCOUNT')) throw new Error('Graphviz output is incomplete.');
  fs.writeFileSync(out, svg);
  console.log(`Generated ${out} with 18 tables and 29 relationships.`);
})();
