param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression

$archiveFullPath = [IO.Path]::GetFullPath($ArchivePath)
$destinationFullPath = [IO.Path]::GetFullPath($DestinationPath)
$destinationPrefix = $destinationFullPath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

if (Test-Path -LiteralPath $destinationFullPath) {
    Remove-Item -LiteralPath $destinationFullPath -Recurse -Force
}
[IO.Directory]::CreateDirectory($destinationFullPath) | Out-Null

$stream = [IO.File]::OpenRead($archiveFullPath)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Read, $false)
$succeeded = $false
try {
    # Validate the complete central directory before creating any archive entry.
    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        $segments = $name.TrimEnd('/').Split('/')
        $isDirectory = $name.EndsWith('/')
        $unixMode = ($entry.ExternalAttributes -shr 16) -band 0xF000
        $hasInvalidSegment = @($segments | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }).Count -gt 0
        $invalid = [string]::IsNullOrWhiteSpace($name) `
            -or $name.StartsWith('/') `
            -or $name -match '^[A-Za-z]:' `
            -or $hasInvalidSegment `
            -or $unixMode -eq 0xA000
        if ($invalid) {
            throw "release.zip_entry_invalid: $name"
        }
        if (-not $seen.Add($name.TrimEnd('/'))) {
            throw "release.zip_entry_invalid: duplicate $name"
        }

        $target = [IO.Path]::GetFullPath([IO.Path]::Combine($destinationFullPath, $name.Replace('/', [IO.Path]::DirectorySeparatorChar)))
        if (-not $target.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "release.zip_entry_invalid: escape $name"
        }
    }

    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        $target = [IO.Path]::GetFullPath([IO.Path]::Combine($destinationFullPath, $name.Replace('/', [IO.Path]::DirectorySeparatorChar)))
        $isDirectory = $name.EndsWith('/')
        if ($isDirectory) {
            [IO.Directory]::CreateDirectory($target) | Out-Null
            continue
        }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        $source = $entry.Open()
        $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $source.CopyTo($output)
            $output.Flush($true)
        }
        finally {
            $output.Dispose()
            $source.Dispose()
        }
    }
    $succeeded = $true
}
finally {
    $archive.Dispose()
    $stream.Dispose()
    if (-not $succeeded -and (Test-Path -LiteralPath $destinationFullPath)) {
        Remove-Item -LiteralPath $destinationFullPath -Recurse -Force
    }
}
