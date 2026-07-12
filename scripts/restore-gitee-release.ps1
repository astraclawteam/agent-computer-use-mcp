[CmdletBinding()]
param(
    [Parameter()]
    [string]$InputRoot = (Get-Location).Path,

    [Parameter()]
    [string]$OutputRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Throw-RestoreError {
    param([string]$Code, [string]$Detail)
    throw "$Code`: $Detail"
}

function Assert-SafeName {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name) -or
        [IO.Path]::GetFileName($Name) -ne $Name -or
        $Name.Contains("/") -or
        $Name.Contains("\")) {
        Throw-RestoreError "gitee.manifest_name_invalid" $Name
    }
}

function Assert-FileIdentity {
    param($Identity, [string]$Path)
    Assert-SafeName ([string]$Identity.name)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Throw-RestoreError "gitee.attachment_missing" ([string]$Identity.name)
    }
    $item = Get-Item -LiteralPath $Path
    $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($item.Length -ne [long]$Identity.sizeBytes -or $hash -ne [string]$Identity.sha256) {
        Throw-RestoreError "gitee.attachment_identity_mismatch" ([string]$Identity.name)
    }
}

$inputPath = [IO.Path]::GetFullPath($InputRoot)
$outputPath = [IO.Path]::GetFullPath($OutputRoot)
$manifestPath = Join-Path $inputPath "gitee-mirror-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Throw-RestoreError "gitee.manifest_missing" "gitee-mirror-manifest.json"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.originals -isnot [Array]) {
    Throw-RestoreError "gitee.manifest_invalid" "schema"
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

$restored = 0
foreach ($original in $manifest.originals) {
    Assert-SafeName ([string]$original.name)
    if ([string]$original.sha256 -notmatch "^[a-f0-9]{64}$" -or [long]$original.sizeBytes -lt 0) {
        Throw-RestoreError "gitee.manifest_invalid" ([string]$original.name)
    }
    $targetPath = Join-Path $outputPath ([string]$original.name)
    if ([string]$original.representation -eq "exact") {
        if ($original.attachments.Count -ne 1 -or $original.attachments[0].name -ne $original.name) {
            Throw-RestoreError "gitee.manifest_invalid" ([string]$original.name)
        }
        $sourcePath = Join-Path $inputPath ([string]$original.name)
        Assert-FileIdentity $original.attachments[0] $sourcePath
        if ([IO.Path]::GetFullPath($sourcePath) -ne [IO.Path]::GetFullPath($targetPath)) {
            if (Test-Path -LiteralPath $targetPath) {
                Throw-RestoreError "gitee.output_exists" ([string]$original.name)
            }
            Copy-Item -LiteralPath $sourcePath -Destination $targetPath
        }
        Assert-FileIdentity $original $targetPath
        $restored += 1
        continue
    }
    if ([string]$original.representation -ne "chunked" -or $original.attachments.Count -lt 2) {
        Throw-RestoreError "gitee.manifest_invalid" ([string]$original.name)
    }
    if (Test-Path -LiteralPath $targetPath) {
        Throw-RestoreError "gitee.output_exists" ([string]$original.name)
    }
    $temporaryPath = "$targetPath.partial-$([Guid]::NewGuid().ToString('N'))"
    try {
        $destination = [IO.File]::Open($temporaryPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            foreach ($attachment in $original.attachments) {
                $partPath = Join-Path $inputPath ([string]$attachment.name)
                Assert-FileIdentity $attachment $partPath
                $source = [IO.File]::OpenRead($partPath)
                try {
                    $source.CopyTo($destination)
                }
                finally {
                    $source.Dispose()
                }
            }
        }
        finally {
            $destination.Dispose()
        }
        Assert-FileIdentity $original $temporaryPath
        Move-Item -LiteralPath $temporaryPath -Destination $targetPath
        $restored += 1
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

Write-Output "gitee.restore_passed: $restored"
