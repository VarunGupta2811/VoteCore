$script = Get-Content -Raw (Join-Path $PSScriptRoot 'script.js')
$staticStyle = Get-Content -Raw (Join-Path $PSScriptRoot 'style.css')
$react = Get-Content -Raw (Join-Path $PSScriptRoot 'react-app\src\App.jsx')
$reactStyle = Get-Content -Raw (Join-Path $PSScriptRoot 'react-app\src\styles.css')

function Assert-Contains([string] $content, [string] $pattern, [string] $message) {
    if ($content -notmatch $pattern) { throw $message }
}

Assert-Contains $script 'function showBallotCelebration\(\)' 'The static frontend is missing its ballot celebration.'
Assert-Contains $script 'matchMedia\("\(prefers-reduced-motion: reduce\)"\)' 'The static ballot celebration ignores reduced-motion preferences.'
Assert-Contains $script '(?s)for \(let line = 0; line < 3; line \+= 1\).*?particle\.append\(document\.createElement\("i"\)\)' 'The static celebration does not render ballot markings.'
Assert-Contains $script '(?s)if \(response\.ok\) \{\s*saveVoteReceipt\(electionId, data\.receipt\);.*?showBallotCelebration\(\);' 'The static celebration is not limited to a successful vote.'
Assert-Contains $staticStyle '(?s)@keyframes ballot-paper-fall' 'The static ballot papers have no fall animation.'
Assert-Contains $staticStyle '(?s)\.ballot-celebration\s*\{[^}]*pointer-events:\s*none' 'The static celebration can intercept page interactions.'
Assert-Contains $react '(?s)function BallotCelebration\(\).*?useReducedMotion\(\).*?ballot-particle' 'The React ballot celebration is missing or ignores reduced motion.'
Assert-Contains $react '(?s)if \(!result\?\.receipt\) return;.*?if \(!shouldReduceMotion\) setCelebrationKey' 'The React celebration is not limited to successful votes or reduced-motion users.'
Assert-Contains $reactStyle '(?s)@keyframes ballot-paper-fall' 'The React ballot papers have no fall animation.'
Assert-Contains $reactStyle '(?s)\.ballot-celebration\s*\{[^}]*pointer-events:\s*none' 'The React celebration can intercept page interactions.'

Write-Output 'Vote celebration contract passed.'
