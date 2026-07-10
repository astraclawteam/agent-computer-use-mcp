param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$GeneratedAt
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression

$sourceRoot = [IO.Path]::GetFullPath($SourcePath)
$sourcePrefix = $sourceRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
$timestamp = [DateTimeOffset]::Parse($GeneratedAt).ToUniversalTime()
if ($timestamp.Year -lt 1980) {
    throw "release.zip_timestamp_invalid"
}

$files = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | ForEach-Object {
    if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "release.zip_link_forbidden: $($_.Name)"
    }
    $fileFullPath = [IO.Path]::GetFullPath($_.FullName)
    if (-not $fileFullPath.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "release.zip_entry_invalid: source escape"
    }
    $relative = $fileFullPath.Substring($sourcePrefix.Length).Replace('\', '/')
    if ($relative.StartsWith('../') -or $relative -eq '..' -or $relative.StartsWith('/')) {
        throw "release.zip_entry_invalid: $relative"
    }
    [pscustomobject]@{ Relative = $relative; FullName = $_.FullName }
} | Sort-Object -Property Relative

[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputFullPath)) | Out-Null
if (Test-Path -LiteralPath $outputFullPath) {
    Remove-Item -LiteralPath $outputFullPath -Force
}
$stream = [IO.File]::Open($outputFullPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
try {
    foreach ($file in $files) {
        $entry = $archive.CreateEntry($file.Relative, [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $timestamp
        $input = [IO.File]::OpenRead($file.FullName)
        $output = $entry.Open()
        try {
            $input.CopyTo($output)
        }
        finally {
            $output.Dispose()
            $input.Dispose()
        }
    }
}
finally {
    $archive.Dispose()
    $stream.Flush($true)
    $stream.Dispose()
}
