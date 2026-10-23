$index = Get-Content -Raw (Join-Path $PSScriptRoot 'index.html')
$style = Get-Content -Raw (Join-Path $PSScriptRoot 'style.css')

function Assert-Contains([string] $content, [string] $pattern, [string] $message) {
    if ($content -notmatch $pattern) { throw $message }
}

# The auth flow depends on these existing DOM hooks and must not change.
foreach ($id in 'loginForm', 'otpForm', 'forgotPasswordForm', 'registerForm', 'email', 'password', 'otpCode') {
    Assert-Contains $index ('id="' + $id + '"') "Required auth element #$id is missing."
}
foreach ($handler in 'login\(\)', 'verifyOTP\(\)', 'toggleForms\(\)', 'showForgotPassword\(\)', 'registerUser\(\)') {
    Assert-Contains $index $handler "Existing auth handler $handler is missing."
}

Assert-Contains $index 'class="auth-nav"' 'The motion landing navigation is missing.'
Assert-Contains $index 'class="auth-atmosphere"' 'The animated landing atmosphere is missing.'
Assert-Contains $style '(?s)\.auth-atmosphere' 'The landing atmosphere has no visual treatment.'
Assert-Contains $style '(?s)@keyframes\s+authDrift' 'The landing atmosphere has no motion keyframes.'
Assert-Contains $style '(?s)\.auth-nav\s*\{' 'The landing navigation has no visual treatment.'
Assert-Contains $style 'prefers-reduced-motion' 'Reduced-motion support is missing.'

Write-Output 'Landing experience contract passed.'
