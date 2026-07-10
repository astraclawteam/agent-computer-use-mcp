using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;

namespace AgentComputerUse.Installer;

internal sealed class AuthenticodeVerifier
{
    private static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    public void Verify(string path, AssetAuthenticodePolicy policy)
    {
        if (string.Equals(policy.Mode, "vendor-unsigned", StringComparison.Ordinal)) return;
        if (!OperatingSystem.IsWindows())
        {
            throw new InstallerException("asset.authenticode_unavailable", "Authenticode verification requires Windows");
        }

        var fileInfo = new WinTrustFileInfo(path);
        var fileInfoPointer = Marshal.AllocHGlobal(Marshal.SizeOf<WinTrustFileInfo>());
        try
        {
            Marshal.StructureToPtr(fileInfo, fileInfoPointer, fDeleteOld: false);
            var data = WinTrustData.ForFile(fileInfoPointer);
            var action = GenericVerifyV2;
            var result = WinVerifyTrust(IntPtr.Zero, ref action, ref data);
            try
            {
                if (result != 0 || data.StateData == IntPtr.Zero)
                {
                    throw new InstallerException("asset.authenticode_required", $"Windows signature verification failed: 0x{result:x8}");
                }
                var signer = GetSigner(data.StateData);
                var certificate = GetSignerCertificate(signer);
                if (string.IsNullOrWhiteSpace(policy.Publisher)
                    || !certificate.Subject.Contains(policy.Publisher, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InstallerException(
                        "asset.authenticode_publisher_mismatch",
                        $"Windows signer publisher is not allowed: {certificate.Subject}");
                }
                if (policy.TimestampRequired && signer.CounterSignerCount == 0)
                {
                    throw new InstallerException("asset.authenticode_timestamp_missing", "Windows signature has no trusted timestamp");
                }
            }
            finally
            {
                if (data.StateData != IntPtr.Zero)
                {
                    data.StateAction = WinTrustData.StateActionClose;
                    WinVerifyTrust(IntPtr.Zero, ref action, ref data);
                }
            }
        }
        finally
        {
            Marshal.DestroyStructure<WinTrustFileInfo>(fileInfoPointer);
            Marshal.FreeHGlobal(fileInfoPointer);
        }
    }

    private static CryptProviderSigner GetSigner(IntPtr stateData)
    {
        var providerData = WTHelperProvDataFromStateData(stateData);
        if (providerData == IntPtr.Zero)
        {
            throw new InstallerException("asset.authenticode_required", "Windows trust provider data is unavailable");
        }
        var signerPointer = WTHelperGetProvSignerFromChain(providerData, 0, false, 0);
        if (signerPointer == IntPtr.Zero)
        {
            throw new InstallerException("asset.authenticode_required", "Windows signer information is unavailable");
        }
        return Marshal.PtrToStructure<CryptProviderSigner>(signerPointer);
    }

    private static X509Certificate2 GetSignerCertificate(CryptProviderSigner signer)
    {
        if (signer.CertificateChain == IntPtr.Zero || signer.CertificateChainCount == 0)
        {
            throw new InstallerException("asset.authenticode_required", "Windows signer certificate is unavailable");
        }
        var providerCertificate = Marshal.PtrToStructure<CryptProviderCertificateHeader>(signer.CertificateChain);
        if (providerCertificate.CertificateContext == IntPtr.Zero)
        {
            throw new InstallerException("asset.authenticode_required", "Windows signer certificate context is unavailable");
        }
        var context = Marshal.PtrToStructure<CertificateContext>(providerCertificate.CertificateContext);
        if (context.EncodedCertificate == IntPtr.Zero || context.EncodedCertificateSize == 0)
        {
            throw new InstallerException("asset.authenticode_required", "Windows signer certificate bytes are unavailable");
        }
        var bytes = new byte[context.EncodedCertificateSize];
        Marshal.Copy(context.EncodedCertificate, bytes, 0, bytes.Length);
        return X509CertificateLoader.LoadCertificate(bytes);
    }

    [DllImport("wintrust.dll", ExactSpelling = true, SetLastError = true)]
    private static extern int WinVerifyTrust(IntPtr window, ref Guid actionId, ref WinTrustData trustData);

    [DllImport("wintrust.dll", ExactSpelling = true)]
    private static extern IntPtr WTHelperProvDataFromStateData(IntPtr stateData);

    [DllImport("wintrust.dll", ExactSpelling = true)]
    private static extern IntPtr WTHelperGetProvSignerFromChain(
        IntPtr providerData,
        uint signerIndex,
        [MarshalAs(UnmanagedType.Bool)] bool counterSigner,
        uint counterSignerIndex);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class WinTrustFileInfo
    {
        public WinTrustFileInfo(string path)
        {
            Size = (uint)Marshal.SizeOf<WinTrustFileInfo>();
            FilePath = path;
        }

        public uint Size;
        [MarshalAs(UnmanagedType.LPWStr)] public string FilePath;
        public IntPtr FileHandle;
        public IntPtr KnownSubject;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WinTrustData
    {
        public const uint StateActionVerify = 1;
        public const uint StateActionClose = 2;

        public uint Size;
        public IntPtr PolicyCallbackData;
        public IntPtr SipClientData;
        public uint UiChoice;
        public uint RevocationChecks;
        public uint UnionChoice;
        public IntPtr FileInfo;
        public uint StateAction;
        public IntPtr StateData;
        public IntPtr UrlReference;
        public uint ProviderFlags;
        public uint UiContext;
        public IntPtr SignatureSettings;

        public static WinTrustData ForFile(IntPtr fileInfo) => new()
        {
            Size = (uint)Marshal.SizeOf<WinTrustData>(),
            UiChoice = 2,
            RevocationChecks = 0,
            UnionChoice = 1,
            FileInfo = fileInfo,
            StateAction = StateActionVerify,
            ProviderFlags = 0x1000 | 0x2000,
            UiContext = 0,
        };
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CryptProviderSigner
    {
        public uint Size;
        public System.Runtime.InteropServices.ComTypes.FILETIME VerifyAsOf;
        public uint CertificateChainCount;
        public IntPtr CertificateChain;
        public uint SignerType;
        public IntPtr SignerInfo;
        public uint Error;
        public uint CounterSignerCount;
        public IntPtr CounterSigners;
        public IntPtr ChainContext;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CryptProviderCertificateHeader
    {
        public uint Size;
        public IntPtr CertificateContext;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CertificateContext
    {
        public uint EncodingType;
        public IntPtr EncodedCertificate;
        public uint EncodedCertificateSize;
        public IntPtr CertificateInfo;
        public IntPtr CertificateStore;
    }
}
