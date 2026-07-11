param(
    [Parameter(Mandatory = $true)][string]$CatalogPath,
    [Parameter(Mandatory = $true)][string]$ExpectedPublisher,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [ValidateSet("PublicTrust")][string]$ProfileType = "PublicTrust"
)

$ErrorActionPreference = "Stop"
$paths = Get-Content -LiteralPath $CatalogPath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
if ($paths.Count -eq 0) { throw "release.signature_catalog_empty" }
$evidence = foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "release.signature_missing: $path" }
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    $timestamped = $null -ne $signature.TimeStamperCertificate
    [pscustomobject]@{
        path = [IO.Path]::GetFullPath($path)
        status = [string]$signature.Status
        publisher = [string]$signature.SignerCertificate.Subject
        timestamped = $timestamped
        timestampStatus = if ($timestamped) { "Valid" } else { "Missing" }
        profileType = $ProfileType
    }
}
$invalid = $evidence | Where-Object {
    $_.status -ne "Valid" -or -not $_.timestamped -or $_.publisher -ne $ExpectedPublisher -or $_.profileType -ne "PublicTrust"
}
$json = ConvertTo-Json -InputObject @($evidence) -Depth 5
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($OutputPath))) | Out-Null
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json + "`n", [Text.UTF8Encoding]::new($false))
if ($invalid) { throw "release.authenticode_gate_failed" }
