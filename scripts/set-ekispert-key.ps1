param(
    [switch]$Clear
)

$variableName = 'EKISPERT_API_ACCESS_KEY'

if ($Clear) {
    [Environment]::SetEnvironmentVariable($variableName, $null, 'User')
    Write-Host "$variableName cleared from the current Windows user environment."
    exit 0
}

$secureValue = Read-Host 'Paste the Ekispert API MCP access key' -AsSecureString
$plainValue = [System.Net.NetworkCredential]::new('', $secureValue).Password

if ([string]::IsNullOrWhiteSpace($plainValue)) {
    throw 'No key was entered.'
}

[Environment]::SetEnvironmentVariable($variableName, $plainValue.Trim(), 'User')
$env:EKISPERT_API_ACCESS_KEY = $plainValue.Trim()
$plainValue = $null

Write-Host "$variableName stored for the current Windows user."
Write-Host 'The value was not written to the repository.'
Write-Host 'Open a new terminal/Codex session before testing live MCP access.'
