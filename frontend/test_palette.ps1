$style = Get-Content -Raw (Join-Path $PSScriptRoot 'style.css')
$admin = Get-Content -Raw (Join-Path $PSScriptRoot 'admin.html')
$script = Get-Content -Raw (Join-Path $PSScriptRoot 'script.js')

function Assert-Contains([string] $pattern, [string] $message) {
    if ($style -notmatch $pattern) {
        throw $message
    }
}

# Every page, including register.html which has no body class, must inherit the
# midnight foundation and the shared coral/aqua accents.
Assert-Contains '(?s)body\s*\{[^}]*background-color:\s*#111827' 'The global body selector does not establish the midnight page background.'
Assert-Contains '(?s)body\s*\{[^}]*rgba\(240,\s*126,\s*101' 'The global body selector does not include the coral aurora accent.'
Assert-Contains '(?s)body\s*\{[^}]*rgba\(77,\s*207,\s*183' 'The global body selector does not include the aqua aurora accent.'
Assert-Contains '(?s)\.btn-primary\s*\{[^}]*#b9473f' 'Primary actions do not retain the coral palette role.'
Assert-Contains '(?s)\.status-pill\s*\{[^}]*#168f85' 'Status surfaces do not retain the teal palette role.'

if ($style -match '(?s)h1::before\s*\{[^}]*rgba\(199,\s*154,\s*61') {
    throw 'The shared heading ornament still uses the retired gold palette.'
}

if ($admin -notmatch 'hosting-requests-card') {
    throw 'The hosting request workspace is not configured to span the admin grid.'
}
if ($script -notmatch 'hosting-request-card') {
    throw 'Hosting requests are not rendered with reusable review-card markup.'
}
Assert-Contains '(?s)#hostRequestsContainer\s*\{[^}]*max-height:\s*34rem' 'The hosting request queue does not provide a usable review height.'
Assert-Contains '(?s)\.hosting-request-card\s*\{' 'The hosting request card does not have a dedicated visual treatment.'

Write-Output 'Palette contract passed.'
