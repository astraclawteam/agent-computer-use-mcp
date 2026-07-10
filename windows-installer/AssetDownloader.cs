using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace AgentComputerUse.Installer;

internal sealed class AssetDownloader(
    InstallerLayout layout,
    AssetCache cache,
    AssetSourcePolicy sourcePolicy)
{
    private const int MaxRedirects = 5;
    private static readonly TimeSpan IdleTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan TotalTimeout = TimeSpan.FromMinutes(3);

    public async Task<CachedAssetBlob> DownloadAsync(
        AssetManifest manifest,
        AssetEntry asset,
        CancellationToken cancellationToken)
    {
        var existing = await cache.TryGetCachedAsync(asset, cancellationToken);
        if (existing is not null) return existing;

        Directory.CreateDirectory(layout.CacheDownloadsRoot);
        var partialPath = Path.Combine(layout.CacheDownloadsRoot, $"{asset.Source.Sha256}.partial");
        var resumePath = Path.Combine(layout.CacheDownloadsRoot, $"{asset.Source.Sha256}.resume.json");
        var sourceUri = new Uri(asset.Source.Urls[0], UriKind.Absolute);
        var resume = ReadResume(resumePath, partialPath, sourceUri, asset);
        var resumeUsed = resume.DownloadedBytes > 0;
        using var totalTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        totalTimeout.CancelAfter(TotalTimeout);

        HttpResponseMessage? response = null;
        try
        {
            (response, sourceUri) = await SendAsync(sourceUri, resume, manifest.DevelopmentOnly, totalTimeout.Token);
            var append = resume.DownloadedBytes > 0
                && response.StatusCode == HttpStatusCode.PartialContent
                && response.Content.Headers.ContentRange?.From == resume.DownloadedBytes
                && ValidatorsMatch(response, resume);
            if (!append)
            {
                ResetPartial(partialPath, resumePath);
                resume = NewResume(sourceUri, asset);
                resumeUsed = false;
            }
            else
            {
                resume.SourceUrl = sourceUri.AbsoluteUri;
            }

            var expectedRemaining = asset.Source.SizeBytes - resume.DownloadedBytes;
            if (response.Content.Headers.ContentLength is long length && length > expectedRemaining)
            {
                ResetPartial(partialPath, resumePath);
                throw new InstallerException("asset.download_size_mismatch", "Asset response size does not match manifest");
            }
            resume.ETag = response.Headers.ETag?.Tag ?? resume.ETag;
            resume.LastModified = response.Content.Headers.LastModified?.ToString("R") ?? resume.LastModified;
            await StreamResponseAsync(response, partialPath, resumePath, resume, asset.Source.SizeBytes, append, totalTimeout.Token);
            try
            {
                var promoted = await cache.PromoteDownloadedAsync(asset, partialPath, resumeUsed, totalTimeout.Token);
                File.Delete(resumePath);
                return promoted;
            }
            catch (InstallerException error) when (error.Code is "asset.download_size_mismatch" or "asset.download_hash_mismatch")
            {
                ResetPartial(partialPath, resumePath);
                throw;
            }
        }
        catch (InstallerException)
        {
            throw;
        }
        catch (OperationCanceledException error)
        {
            PersistResumeFromPartial(resumePath, partialPath, resume);
            throw new InstallerException("asset.download_timeout", error.Message);
        }
        catch (Exception error) when (error is HttpRequestException or IOException)
        {
            PersistResumeFromPartial(resumePath, partialPath, resume);
            throw new InstallerException("asset.download_interrupted", error.Message);
        }
        finally
        {
            response?.Dispose();
        }
    }

    private async Task<(HttpResponseMessage Response, Uri FinalUri)> SendAsync(
        Uri initialUri,
        AssetResumeMetadata resume,
        bool developmentOnly,
        CancellationToken cancellationToken)
    {
        using var handler = new HttpClientHandler { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.None };
        using var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        var current = initialUri;
        for (var redirect = 0; redirect <= MaxRedirects; redirect += 1)
        {
            await sourcePolicy.ValidateNetworkUriAsync(current, developmentOnly, cancellationToken);
            using var request = new HttpRequestMessage(HttpMethod.Get, current);
            if (resume.DownloadedBytes > 0)
            {
                request.Headers.Range = new RangeHeaderValue(resume.DownloadedBytes, null);
                if (!string.IsNullOrWhiteSpace(resume.ETag))
                {
                    request.Headers.TryAddWithoutValidation("If-Range", resume.ETag);
                }
                else if (DateTimeOffset.TryParse(resume.LastModified, out var lastModified))
                {
                    request.Headers.IfRange = new RangeConditionHeaderValue(lastModified);
                }
            }
            var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!IsRedirect(response.StatusCode))
            {
                if (!response.IsSuccessStatusCode)
                {
                    response.Dispose();
                    throw new InstallerException("asset.download_http_error", $"Asset server returned {(int)response.StatusCode}");
                }
                return (response, current);
            }
            var location = response.Headers.Location;
            response.Dispose();
            if (location is null)
            {
                throw new InstallerException("asset.source_forbidden", "Asset redirect has no location");
            }
            current = location.IsAbsoluteUri ? location : new Uri(current, location);
        }
        throw new InstallerException("asset.source_forbidden", "Asset redirect limit exceeded");
    }

    private static async Task StreamResponseAsync(
        HttpResponseMessage response,
        string partialPath,
        string resumePath,
        AssetResumeMetadata resume,
        long expectedSize,
        bool append,
        CancellationToken cancellationToken)
    {
        await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var output = new FileStream(
            partialPath,
            append ? FileMode.Append : FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            1024 * 64,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var buffer = new byte[1024 * 64];
        while (true)
        {
            using var idle = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            idle.CancelAfter(IdleTimeout);
            var count = await input.ReadAsync(buffer, idle.Token);
            if (count == 0) break;
            resume.DownloadedBytes = checked(resume.DownloadedBytes + count);
            if (resume.DownloadedBytes > expectedSize)
            {
                throw new InstallerException("asset.download_size_mismatch", "Asset response exceeds manifest size");
            }
            await output.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
            WriteResumeAtomically(resumePath, resume);
        }
        await output.FlushAsync(cancellationToken);
        output.Flush(flushToDisk: true);
        if (resume.DownloadedBytes != expectedSize)
        {
            throw new IOException("Asset response ended before the expected size");
        }
    }

    private static AssetResumeMetadata ReadResume(
        string resumePath,
        string partialPath,
        Uri sourceUri,
        AssetEntry asset)
    {
        if (!File.Exists(resumePath) || !File.Exists(partialPath))
        {
            ResetPartial(partialPath, resumePath);
            return NewResume(sourceUri, asset);
        }
        try
        {
            var resume = JsonSerializer.Deserialize(
                File.ReadAllText(resumePath),
                InstallerJsonContext.Default.AssetResumeMetadata);
            if (resume is null
                || resume.SchemaVersion != 1
                || !string.Equals(resume.SourceUrl, sourceUri.AbsoluteUri, StringComparison.Ordinal)
                || !string.Equals(resume.ExpectedSha256, asset.Source.Sha256, StringComparison.Ordinal)
                || resume.ExpectedSizeBytes != asset.Source.SizeBytes
                || resume.DownloadedBytes <= 0
                || resume.DownloadedBytes >= asset.Source.SizeBytes
                || new FileInfo(partialPath).Length != resume.DownloadedBytes)
            {
                throw new JsonException("Resume metadata does not match partial file");
            }
            return resume;
        }
        catch (JsonException)
        {
            ResetPartial(partialPath, resumePath);
            return NewResume(sourceUri, asset);
        }
    }

    private static AssetResumeMetadata NewResume(Uri sourceUri, AssetEntry asset) => new()
    {
        SourceUrl = sourceUri.AbsoluteUri,
        ExpectedSha256 = asset.Source.Sha256,
        ExpectedSizeBytes = asset.Source.SizeBytes,
    };

    private static bool ValidatorsMatch(HttpResponseMessage response, AssetResumeMetadata resume)
    {
        var etag = response.Headers.ETag?.Tag;
        if (!string.IsNullOrWhiteSpace(resume.ETag)) return string.Equals(etag, resume.ETag, StringComparison.Ordinal);
        var lastModified = response.Content.Headers.LastModified?.ToString("R");
        return string.IsNullOrWhiteSpace(resume.LastModified)
            || string.Equals(lastModified, resume.LastModified, StringComparison.Ordinal);
    }

    private static bool IsRedirect(HttpStatusCode status) => status is
        HttpStatusCode.Moved or
        HttpStatusCode.Redirect or
        HttpStatusCode.RedirectMethod or
        HttpStatusCode.TemporaryRedirect or
        HttpStatusCode.PermanentRedirect;

    private static void PersistResumeFromPartial(string resumePath, string partialPath, AssetResumeMetadata resume)
    {
        if (!File.Exists(partialPath)) return;
        var length = new FileInfo(partialPath).Length;
        if (length <= 0 || length >= resume.ExpectedSizeBytes) return;
        resume.DownloadedBytes = length;
        WriteResumeAtomically(resumePath, resume);
    }

    private static void WriteResumeAtomically(string path, AssetResumeMetadata resume)
    {
        var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(resume, InstallerJsonContext.Default.AssetResumeMetadata));
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static void ResetPartial(string partialPath, string resumePath)
    {
        if (File.Exists(partialPath)) File.Delete(partialPath);
        if (File.Exists(resumePath)) File.Delete(resumePath);
    }
}
