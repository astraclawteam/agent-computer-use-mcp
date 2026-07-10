using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace GatewayComputerUseOverlay;

internal interface ILayeredWindowNative
{
    IntPtr GetDC();
    int ReleaseDC(IntPtr screenDc);
    IntPtr CreateCompatibleDC(IntPtr screenDc);
    IntPtr SelectObject(IntPtr memoryDc, IntPtr gdiObject);
    bool DeleteObject(IntPtr gdiObject);
    bool DeleteDC(IntPtr memoryDc);
    bool UpdateLayeredWindow(IntPtr windowHandle, IntPtr screenDc, Point screenLocation, Size size, IntPtr memoryDc, out int errorCode);
}

internal interface ILayeredWindowBitmapFactory
{
    IntPtr CreateHbitmap(Bitmap frame);
}

internal sealed class LayeredWindowPresenter
{
    private const byte AC_SRC_OVER = 0;
    private const byte AC_SRC_ALPHA = 1;
    private const uint ULW_ALPHA = 0x00000002;
    private static readonly IntPtr HgdError = new(-1);

    private readonly ILayeredWindowNative _native;
    private readonly ILayeredWindowBitmapFactory _bitmapFactory;
    private readonly Func<Form, IntPtr> _windowHandleResolver;

    public LayeredWindowPresenter()
        : this(new WindowsLayeredWindowNative(), new WindowsLayeredWindowBitmapFactory(), static window => window.Handle)
    {
    }

    internal LayeredWindowPresenter(ILayeredWindowNative native)
        : this(native, new WindowsLayeredWindowBitmapFactory(), static window => window.Handle)
    {
    }

    internal LayeredWindowPresenter(
        ILayeredWindowNative native,
        ILayeredWindowBitmapFactory bitmapFactory,
        Func<Form, IntPtr> windowHandleResolver)
    {
        ArgumentNullException.ThrowIfNull(native);
        ArgumentNullException.ThrowIfNull(bitmapFactory);
        ArgumentNullException.ThrowIfNull(windowHandleResolver);
        _native = native;
        _bitmapFactory = bitmapFactory;
        _windowHandleResolver = windowHandleResolver;
    }

    public void Present(Form window, Bitmap frame, Point screenLocation)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(frame);
        if (frame.PixelFormat != PixelFormat.Format32bppPArgb)
        {
            throw new ArgumentException("Layered window frames must use Format32bppPArgb.", nameof(frame));
        }

        var screenDc = IntPtr.Zero;
        var memoryDc = IntPtr.Zero;
        var bitmap = IntPtr.Zero;
        var previousBitmap = IntPtr.Zero;
        Exception? presentationException = null;

        try
        {
            var windowHandle = _windowHandleResolver(window);
            screenDc = _native.GetDC();
            if (screenDc == IntPtr.Zero)
            {
                throw new InvalidOperationException("GetDC failed.");
            }

            memoryDc = _native.CreateCompatibleDC(screenDc);
            if (memoryDc == IntPtr.Zero)
            {
                throw new InvalidOperationException("CreateCompatibleDC failed.");
            }

            bitmap = _bitmapFactory.CreateHbitmap(frame);
            if (bitmap == IntPtr.Zero)
            {
                throw new InvalidOperationException("GetHbitmap failed.");
            }

            previousBitmap = _native.SelectObject(memoryDc, bitmap);
            if (previousBitmap == IntPtr.Zero || previousBitmap == HgdError)
            {
                throw new InvalidOperationException("SelectObject failed.");
            }

            if (!_native.UpdateLayeredWindow(windowHandle, screenDc, screenLocation, frame.Size, memoryDc, out var errorCode))
            {
                throw new Win32Exception(errorCode, "UpdateLayeredWindow failed.");
            }
        }
        catch (Exception exception)
        {
            presentationException = exception;
            throw;
        }
        finally
        {
            var cleanupException = Cleanup(_native, screenDc, memoryDc, bitmap, previousBitmap);
            if (presentationException is null && cleanupException is not null)
            {
                ExceptionDispatchInfo.Capture(cleanupException).Throw();
            }
        }
    }

    private static Exception? Cleanup(
        ILayeredWindowNative native,
        IntPtr screenDc,
        IntPtr memoryDc,
        IntPtr bitmap,
        IntPtr previousBitmap)
    {
        Exception? cleanupException = null;
        var memoryDcDeleted = memoryDc == IntPtr.Zero;

        if (memoryDc != IntPtr.Zero && previousBitmap != IntPtr.Zero && previousBitmap != HgdError)
        {
            try
            {
                var restoredBitmap = native.SelectObject(memoryDc, previousBitmap);
                if (restoredBitmap != bitmap)
                {
                    cleanupException ??= new InvalidOperationException("SelectObject failed while restoring the previous bitmap.");
                }
            }
            catch (Exception exception)
            {
                cleanupException ??= exception;
            }
        }

        if (memoryDc != IntPtr.Zero)
        {
            try
            {
                if (!native.DeleteDC(memoryDc))
                {
                    cleanupException ??= new InvalidOperationException("DeleteDC failed during cleanup.");
                }
                else
                {
                    memoryDcDeleted = true;
                }
            }
            catch (Exception exception)
            {
                cleanupException ??= exception;
            }
        }

        if (memoryDcDeleted && bitmap != IntPtr.Zero)
        {
            try
            {
                if (!native.DeleteObject(bitmap))
                {
                    cleanupException ??= new InvalidOperationException("DeleteObject failed during cleanup.");
                }
            }
            catch (Exception exception)
            {
                cleanupException ??= exception;
            }
        }

        if (screenDc != IntPtr.Zero)
        {
            try
            {
                if (native.ReleaseDC(screenDc) != 1)
                {
                    cleanupException ??= new InvalidOperationException("ReleaseDC failed during cleanup.");
                }
            }
            catch (Exception exception)
            {
                cleanupException ??= exception;
            }
        }

        return cleanupException;
    }

    private sealed class WindowsLayeredWindowBitmapFactory : ILayeredWindowBitmapFactory
    {
        public IntPtr CreateHbitmap(Bitmap frame) => frame.GetHbitmap(Color.FromArgb(0, 0, 0, 0));
    }

    private sealed class WindowsLayeredWindowNative : ILayeredWindowNative
    {
        public IntPtr GetDC() => GetDC(IntPtr.Zero);

        public int ReleaseDC(IntPtr screenDc) => ReleaseDC(IntPtr.Zero, screenDc);

        public IntPtr CreateCompatibleDC(IntPtr screenDc) => CreateCompatibleDCNative(screenDc);

        public IntPtr SelectObject(IntPtr memoryDc, IntPtr gdiObject) => SelectObjectNative(memoryDc, gdiObject);

        public bool DeleteObject(IntPtr gdiObject) => DeleteObjectNative(gdiObject);

        public bool DeleteDC(IntPtr memoryDc) => DeleteDCNative(memoryDc);

        public bool UpdateLayeredWindow(
            IntPtr windowHandle,
            IntPtr screenDc,
            Point screenLocation,
            Size size,
            IntPtr memoryDc,
            out int errorCode)
        {
            var destination = new POINT(screenLocation.X, screenLocation.Y);
            var source = new POINT(0, 0);
            var nativeSize = new SIZE(size.Width, size.Height);
            var blend = new BLENDFUNCTION {
                BlendOp = AC_SRC_OVER,
                SourceConstantAlpha = 255,
                AlphaFormat = AC_SRC_ALPHA,
            };

            var updated = UpdateLayeredWindow(
                windowHandle,
                screenDc,
                ref destination,
                ref nativeSize,
                memoryDc,
                ref source,
                0u,
                ref blend,
                ULW_ALPHA);
            errorCode = updated ? 0 : Marshal.GetLastWin32Error();
            return updated;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDc);

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateCompatibleDCNative(IntPtr hDc);

        [DllImport("gdi32.dll")]
        private static extern IntPtr SelectObjectNative(IntPtr hDc, IntPtr hGdiObj);

        [DllImport("gdi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DeleteObjectNative(IntPtr hObject);

        [DllImport("gdi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DeleteDCNative(IntPtr hDc);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UpdateLayeredWindow(
            IntPtr hWnd,
            IntPtr hDcDst,
            ref POINT pptDst,
            ref SIZE pSize,
            IntPtr hDcSrc,
            ref POINT pptSrc,
            uint crKey,
            ref BLENDFUNCTION blend,
            uint flags);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public POINT(int x, int y)
        {
            X = x;
            Y = y;
        }

        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE
    {
        public SIZE(int width, int height)
        {
            Width = width;
            Height = height;
        }

        public int Width;
        public int Height;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BLENDFUNCTION
    {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }
}
