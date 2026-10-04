$generatorDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Join-Path (Get-Location) 'tmp' }
$outputPath = Join-Path $generatorDirectory 'votecore-er-diagram.svg'

$tables = @(
    @{ Name='GOV_IDENTITY'; X=110; Y=120; PK=@('PID'); FK=@('PID → UACCOUNT.PID'); Other=5 },
    @{ Name='IDENTITY_WALLET'; X=110; Y=510; PK=@('WALLET_ID'); FK=@('PID → UACCOUNT.PID'); Other=3 },
    @{ Name='OTP_VERIFICATION'; X=110; Y=900; PK=@('OTP_ID'); FK=@('PID → UACCOUNT.PID'); Other=5 },
    @{ Name='USER_SESSIONS'; X=110; Y=1290; PK=@('SESSION_ID'); FK=@('PID → UACCOUNT.PID'); Other=3 },
    @{ Name='ELECTION_HOST_REQUEST'; X=110; Y=1680; PK=@('REQUEST_ID'); FK=@('REQUESTER_PID → UACCOUNT.PID'); Other=5 },
    @{ Name='POLITICAL_PARTY'; X=650; Y=110; PK=@('PARTY_ID'); FK=@('FOUNDER_PID → UACCOUNT.PID'); Other=3 },
    @{ Name='AUDIT_LOGS'; X=650; Y=1590; PK=@('LOG_ID'); FK=@('PID → UACCOUNT.PID'); Other=3 },
    @{ Name='UACCOUNT'; X=1120; Y=710; PK=@('PID'); FK=@(); Other=8 },
    @{ Name='HOST_JURISDICTION'; X=1660; Y=110; PK=@('JURISDICTION_ID'); FK=@(); Other=4 },
    @{ Name='ELECTION'; X=1690; Y=660; PK=@('ELECTION_ID'); FK=@('JURISDICTION_ID → HOST_JURISDICTION.JURISDICTION_ID', 'ORGANIZER_PID → UACCOUNT.PID'); Other=7 },
    @{ Name='EVENT_PARTICIPANTS'; X=1690; Y=1200; PK=@('ELECTION_ID + PID'); FK=@('ELECTION_ID → ELECTION.ELECTION_ID', 'PID → UACCOUNT.PID'); Other=2 },
    @{ Name='FRAUD_LOGS'; X=1690; Y=1630; PK=@('FRAUD_ID'); FK=@('PID → UACCOUNT.PID', 'ELECTION_ID → ELECTION.ELECTION_ID'); Other=4 },
    @{ Name='ELECTION_POSITION'; X=2340; Y=440; PK=@('POSITION_ID'); FK=@('ELECTION_ID → ELECTION.ELECTION_ID'); Other=3 },
    @{ Name='ELECTION_PARTY'; X=2340; Y=990; PK=@('ELECTION_PARTY_ID'); FK=@('ELECTION_ID → ELECTION.ELECTION_ID', 'PARTY_ID → POLITICAL_PARTY.PARTY_ID', 'CAMPAIGN_LEADER_PID → UACCOUNT.PID'); Other=3 },
    @{ Name='VOTER_POST_STATUS'; X=2340; Y=1580; PK=@('ELECTION_ID + POSITION_ID + PID'); FK=@('ELECTION_ID → ELECTION.ELECTION_ID', 'POSITION_ID → ELECTION_POSITION.POSITION_ID', 'PID → UACCOUNT.PID'); Other=2 },
    @{ Name='CANDIDATE'; X=3100; Y=370; PK=@('CANDIDATE_ID'); FK=@('ELECTION_ID → ELECTION.ELECTION_ID', 'PID → UACCOUNT.PID', 'POSITION_ID → ELECTION_POSITION.POSITION_ID', 'ELECTION_PARTY_ID → ELECTION_PARTY.ELECTION_PARTY_ID'); Other=5 },
    @{ Name='ELECTION_PARTY_MEMBER'; X=3100; Y=1000; PK=@('ELECTION_PARTY_ID + PID'); FK=@('ELECTION_PARTY_ID → ELECTION_PARTY.ELECTION_PARTY_ID', 'ELECTION_ID → ELECTION.ELECTION_ID', 'PID → UACCOUNT.PID'); Other=3 },
    @{ Name='VOTE'; X=3100; Y=1630; PK=@('VOTE_ID'); FK=@('ELECTION_ID → ELECTION.ELECTION_ID', 'CANDIDATE_ID → CANDIDATE.CANDIDATE_ID', 'POSITION_ID → ELECTION_POSITION.POSITION_ID'); Other=1 }
)

$relationships = @(
    'GOV_IDENTITY.PID → UACCOUNT.PID', 'IDENTITY_WALLET.PID → UACCOUNT.PID', 'OTP_VERIFICATION.PID → UACCOUNT.PID',
    'USER_SESSIONS.PID → UACCOUNT.PID', 'ELECTION_HOST_REQUEST.REQUESTER_PID → UACCOUNT.PID', 'POLITICAL_PARTY.FOUNDER_PID → UACCOUNT.PID',
    'ELECTION.JURISDICTION_ID → HOST_JURISDICTION.JURISDICTION_ID', 'ELECTION.ORGANIZER_PID → UACCOUNT.PID',
    'EVENT_PARTICIPANTS.ELECTION_ID → ELECTION.ELECTION_ID', 'EVENT_PARTICIPANTS.PID → UACCOUNT.PID',
    'ELECTION_PARTY.ELECTION_ID → ELECTION.ELECTION_ID', 'ELECTION_PARTY.PARTY_ID → POLITICAL_PARTY.PARTY_ID', 'ELECTION_PARTY.CAMPAIGN_LEADER_PID → UACCOUNT.PID',
    'ELECTION_PARTY_MEMBER.ELECTION_PARTY_ID → ELECTION_PARTY.ELECTION_PARTY_ID', 'ELECTION_PARTY_MEMBER.ELECTION_ID → ELECTION.ELECTION_ID', 'ELECTION_PARTY_MEMBER.PID → UACCOUNT.PID',
    'CANDIDATE.ELECTION_ID → ELECTION.ELECTION_ID', 'CANDIDATE.PID → UACCOUNT.PID', 'CANDIDATE.POSITION_ID → ELECTION_POSITION.POSITION_ID', 'CANDIDATE.ELECTION_PARTY_ID → ELECTION_PARTY.ELECTION_PARTY_ID',
    'VOTER_POST_STATUS.ELECTION_ID → ELECTION.ELECTION_ID', 'VOTER_POST_STATUS.POSITION_ID → ELECTION_POSITION.POSITION_ID', 'VOTER_POST_STATUS.PID → UACCOUNT.PID',
    'VOTE.ELECTION_ID → ELECTION.ELECTION_ID', 'VOTE.CANDIDATE_ID → CANDIDATE.CANDIDATE_ID', 'VOTE.POSITION_ID → ELECTION_POSITION.POSITION_ID',
    'AUDIT_LOGS.PID → UACCOUNT.PID', 'FRAUD_LOGS.PID → UACCOUNT.PID', 'FRAUD_LOGS.ELECTION_ID → ELECTION.ELECTION_ID'
)

function Esc([string]$value) { [System.Security.SecurityElement]::Escape($value) }
function NodeHeight($table) { 72 + (26 * ($table.PK.Count + $table.FK.Count)) + 28 }

$tableMap = @{}
foreach ($table in $tables) { $tableMap[$table.Name] = $table }

$svg = [System.Text.StringBuilder]::new()
[void]$svg.AppendLine('<svg xmlns="http://www.w3.org/2000/svg" width="4200" height="2200" viewBox="0 0 4200 2200" role="img" aria-labelledby="title description">')
[void]$svg.AppendLine('<title id="title">VoteCore V2 entity relationship diagram</title><desc id="description">Eighteen database tables, their primary keys, foreign keys, and twenty-nine declared foreign-key relationships.</desc>')
[void]$svg.AppendLine('<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 Z" fill="#14b8a6"/></marker><filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#0f172a" flood-opacity=".16"/></filter></defs>')
[void]$svg.AppendLine('<rect width="4200" height="2200" fill="#0f172a"/><g opacity=".22" stroke="#a78bfa" stroke-width="1"><path d="M0 220H4200M0 660H4200M0 1100H4200M0 1540H4200M0 1980H4200"/><path d="M420 0V2200M840 0V2200M1260 0V2200M1680 0V2200M2100 0V2200M2520 0V2200M2940 0V2200M3360 0V2200M3780 0V2200"/></g>')
[void]$svg.AppendLine('<text x="110" y="70" fill="#f8fafc" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="700">VoteCore V2 · Entity Relationship Diagram</text><text x="110" y="108" fill="#c4b5fd" font-family="Segoe UI, Arial, sans-serif" font-size="20">Oracle schema · PK = primary key · FK = foreign key · arrows point from child FK to parent PK</text>')

# Draw every relationship before cards. Each connection gets its own exterior routing lane, so arrows never share a segment.
for ($index = 0; $index -lt $relationships.Count; $index++) {
    $relationship = $relationships[$index]
    $parts = $relationship -split ' → '
    $childName = ($parts[0] -split '\.')[0]
    $parentName = ($parts[1] -split '\.')[0]
    $child = $tableMap[$childName]
    $parent = $tableMap[$parentName]
    $childHeight = NodeHeight $child
    $parentHeight = NodeHeight $parent
    $startX = if ($parent.X -gt $child.X) { $child.X + 320 } else { $child.X }
    $endX = if ($parent.X -gt $child.X) { $parent.X } else { $parent.X + 320 }
    $startY = $child.Y + [Math]::Min(54 + (($index % 5) * 24), $childHeight - 22)
    $endY = $parent.Y + [Math]::Min(54 + ((($index + 2) % 5) * 24), $parentHeight - 22)
    $laneX = if ($index % 2 -eq 0) { 35 + ($index * 12) } else { 4165 - ($index * 12) }
    $path = "M $startX $startY H $laneX V $endY H $endX"
    [void]$svg.AppendLine("<path data-relationship=`"$([System.Security.SecurityElement]::Escape($relationship))`" d=`"$path`" fill=`"none`" stroke=`"#14b8a6`" stroke-width=`"2.25`" stroke-linejoin=`"round`" marker-end=`"url(#arrow)`" opacity=`".88`"><title>$([System.Security.SecurityElement]::Escape($relationship))</title></path>")
}

foreach ($table in $tables) {
    $height = NodeHeight $table
    $x = $table.X; $y = $table.Y
    [void]$svg.AppendLine("<g data-table=`"$($table.Name)`" filter=`"url(#shadow)`">")
    [void]$svg.AppendLine("<rect x=`"$x`" y=`"$y`" width=`"320`" height=`"$height`" rx=`"16`" fill=`"#f8fafc`" stroke=`"#a78bfa`" stroke-width=`"2`"/>")
    [void]$svg.AppendLine("<path d=`"M $($x+16) $y H $($x+304) Q $($x+320) $y $($x+320) $($y+16) V $($y+46) H $x V $($y+16) Q $x $y $($x+16) $y Z`" fill=`"#5b4bc4`"/>")
    [void]$svg.AppendLine("<text x=`"$($x+18)`" y=`"$($y+30)`" fill=`"#ffffff`" font-family=`"Segoe UI, Arial, sans-serif`" font-size=`"18`" font-weight=`"700`">$($table.Name)</text>")
    $rowY = $y + 72
    foreach ($pk in $table.PK) {
        [void]$svg.AppendLine("<text x=`"$($x+18)`" y=`"$rowY`" fill=`"#5b4bc4`" font-family=`"Consolas, monospace`" font-size=`"15`" font-weight=`"700`">PK</text><text x=`"$($x+58)`" y=`"$rowY`" fill=`"#18233d`" font-family=`"Consolas, monospace`" font-size=`"15`">$([System.Security.SecurityElement]::Escape($pk))</text>")
        $rowY += 26
    }
    foreach ($fk in $table.FK) {
        [void]$svg.AppendLine("<text x=`"$($x+18)`" y=`"$rowY`" fill=`"#0f8c85`" font-family=`"Consolas, monospace`" font-size=`"15`" font-weight=`"700`">FK</text><text x=`"$($x+58)`" y=`"$rowY`" fill=`"#18233d`" font-family=`"Consolas, monospace`" font-size=`"13`">$([System.Security.SecurityElement]::Escape($fk))</text>")
        $rowY += 26
    }
    [void]$svg.AppendLine("<line x1=`"$($x+18)`" y1=`"$($rowY-10)`" x2=`"$($x+302)`" y2=`"$($rowY-10)`" stroke=`"#d8d8f0`"/><text x=`"$($x+18)`" y=`"$($rowY+12)`" fill=`"#64748b`" font-family=`"Segoe UI, Arial, sans-serif`" font-size=`"13`">+ $($table.Other) non-key column(s)</text>")
    [void]$svg.AppendLine('</g>')
}

[void]$svg.AppendLine('<g transform="translate(110 2070)"><rect width="1650" height="82" rx="12" fill="#172554" stroke="#5eead4" stroke-width="1.5"/><path d="M38 25H130" stroke="#14b8a6" stroke-width="3" marker-end="url(#arrow)"/><text x="155" y="31" fill="#f8fafc" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700">Relationship direction</text><text x="155" y="58" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="14">Child-table foreign key → referenced parent-table primary key</text><text x="975" y="31" fill="#f8fafc" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700">Layout note</text><text x="975" y="58" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="14">Every connector has a dedicated exterior routing lane.</text></g>')
[void]$svg.AppendLine('</svg>')

[System.IO.File]::WriteAllText($outputPath, $svg.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Output "Generated $outputPath"
