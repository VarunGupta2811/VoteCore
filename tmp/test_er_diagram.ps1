$diagramPath = Join-Path $PSScriptRoot 'votecore-er-diagram.svg'

if (-not (Test-Path $diagramPath)) {
    throw 'ER diagram SVG has not been generated.'
}

$svg = Get-Content -Raw $diagramPath
$tables = @(
    'UACCOUNT', 'GOV_IDENTITY', 'IDENTITY_WALLET', 'OTP_VERIFICATION',
    'USER_SESSIONS', 'ELECTION_HOST_REQUEST', 'HOST_JURISDICTION',
    'POLITICAL_PARTY', 'ELECTION', 'ELECTION_POSITION', 'EVENT_PARTICIPANTS',
    'ELECTION_PARTY', 'ELECTION_PARTY_MEMBER', 'CANDIDATE',
    'VOTER_POST_STATUS', 'VOTE', 'AUDIT_LOGS', 'FRAUD_LOGS'
)

foreach ($table in $tables) {
    if ($svg -notmatch "data-table=`"$table`"" -and $svg -notmatch "<title>$table</title>") {
        throw "ER diagram is missing table $table."
    }
}

if ((($svg | Select-String -AllMatches 'data-relationship=').Matches.Count -ne 30) -and (($svg | Select-String -AllMatches '<g id="edge').Matches.Count -ne 30)) {
    throw 'ER diagram must contain every one of the 30 declared foreign-key relationships.'
}

if ($svg -notmatch 'PK' -or $svg -notmatch 'FK') {
    throw 'ER diagram does not visibly mark primary and foreign keys.'
}

Write-Output 'ER diagram contract passed.'
