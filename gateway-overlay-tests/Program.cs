using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;
using GatewayComputerUseOverlay;

namespace GatewayComputerUseOverlay.Tests;

internal static class Program
{
    private static readonly IntPtr FakeWindowHandle = new(10);
    private static readonly IntPtr FakeScreenDc = new(11);
    private static readonly IntPtr FakeMemoryDc = new(12);
    private static readonly IntPtr FakeBitmapHandle = new(13);
    private static readonly IntPtr FakePreviousBitmap = new(14);

    [STAThread]
    private static int Main()
    {
        var tests = new (string Name, Action Run)[] {
            ("excludes virtual display adapter families by default", ExcludesVirtualDisplayFamiliesByDefault),
            ("prefers the foreground physical display", PrefersForegroundPhysicalDisplay),
            ("falls back to the primary physical display", FallsBackToPrimaryPhysicalDisplay),
            ("allows a foreground virtual display only with host opt-in", AllowsForegroundVirtualDisplayWithHostOptIn),
            ("returns no display when only excluded adapters are available", ReturnsNoDisplayWhenOnlyExcludedAdaptersAreAvailable),
            ("uses the approved visibility envelope", UsesApprovedVisibilityEnvelope),
            ("renders symmetric luminance on all four edges", RendersSymmetricLuminanceOnAllFourEdges),
            ("renders a closed river through all four corners", RendersClosedRiverThroughAllFourCorners),
            ("rejects non-premultiplied frames before native acquisition", RejectsNonPremultipliedFramesBeforeNativeAcquisition),
            ("handles acquisition failures without real native handles", HandlesAcquisitionFailuresWithoutRealNativeHandles),
            ("reports a false presentation operation after ordered cleanup", ReportsFalsePresentationAfterOrderedCleanup),
            ("preserves presentation exceptions across every thrown cleanup operation", PreservesPresentationExceptionsAcrossThrownCleanupOperations),
            ("deletes a deselected bitmap when memory DC destruction fails", DeletesDeselectedBitmapWhenMemoryDcDestructionFails),
            ("reports false cleanup operations after presentation succeeds", ReportsFalseCleanupOperationsAfterPresentationSucceeds),
        };

        var failures = 0;
        foreach (var (name, run) in tests)
        {
            try
            {
                run();
                Console.WriteLine($"PASS: {name}");
            }
            catch (Exception exception)
            {
                failures++;
                Console.Error.WriteLine($"FAIL: {name}: {exception.Message}");
            }
        }

        return failures == 0 ? 0 : 1;
    }

    private static void ExcludesVirtualDisplayFamiliesByDefault()
    {
        var physical = Candidate("physical", new Rectangle(0, 0, 1920, 1080));
        var excluded = new[] {
            Candidate("virtual", new Rectangle(1920, 0, 1920, 1080), isPrimary: true, isForeground: true, deviceString: "Contoso Virtual Display Adapter"),
            Candidate("remote", new Rectangle(1920, 0, 1920, 1080), isPrimary: true, isForeground: true, isRemote: true),
            Candidate("mirroring", new Rectangle(1920, 0, 1920, 1080), isPrimary: true, isForeground: true, isMirroring: true),
            Candidate("indirect", new Rectangle(1920, 0, 1920, 1080), isPrimary: true, isForeground: true, deviceString: "Indirect Display Adapter"),
            Candidate("vdd", new Rectangle(1920, 0, 1920, 1080), isPrimary: true, isForeground: true, deviceId: "ROOT\\VDD\\0000"),
            Candidate("remote-desktop", new Rectangle(1920, 0, 1920, 1080), isPrimary: true, isForeground: true, deviceKey: "Remote Desktop Display Driver"),
        };

        foreach (var virtualDisplay in excluded)
        {
            var selected = OverlayDisplaySelector.Select([virtualDisplay, physical], allowVirtualDisplays: false);
            Require(selected?.DeviceName == physical.DeviceName, $"{virtualDisplay.DeviceName} must be excluded by default.");
        }
    }

    private static void PrefersForegroundPhysicalDisplay()
    {
        var primary = Candidate("primary", new Rectangle(0, 0, 1920, 1080), isPrimary: true);
        var foreground = Candidate("foreground", new Rectangle(1920, 0, 2560, 1440), isForeground: true);

        var selected = OverlayDisplaySelector.Select([primary, foreground], allowVirtualDisplays: false);

        Require(selected?.DeviceName == foreground.DeviceName, "The foreground physical display must win over the primary display.");
    }

    private static void FallsBackToPrimaryPhysicalDisplay()
    {
        var secondary = Candidate("secondary", new Rectangle(1920, 0, 1920, 1080));
        var primary = Candidate("primary", new Rectangle(0, 0, 1920, 1080), isPrimary: true);

        var selected = OverlayDisplaySelector.Select([secondary, primary], allowVirtualDisplays: false);

        Require(selected?.DeviceName == primary.DeviceName, "The primary physical display must be the fallback.");
    }

    private static void AllowsForegroundVirtualDisplayWithHostOptIn()
    {
        var physical = Candidate("physical", new Rectangle(0, 0, 1920, 1080), isPrimary: true);
        var virtualForeground = Candidate(
            "virtual",
            new Rectangle(1920, 0, 1920, 1080),
            isForeground: true,
            deviceString: "Virtual Display Adapter");

        var selected = OverlayDisplaySelector.Select([physical, virtualForeground], allowVirtualDisplays: true);

        Require(selected?.DeviceName == virtualForeground.DeviceName, "Host opt-in must permit the foreground virtual display.");
    }

    private static void ReturnsNoDisplayWhenOnlyExcludedAdaptersAreAvailable()
    {
        var virtualPrimary = Candidate(
            "virtual",
            new Rectangle(0, 0, 1920, 1080),
            isPrimary: true,
            isForeground: true,
            deviceString: "Virtual Display Adapter");

        var selected = OverlayDisplaySelector.Select([virtualPrimary], allowVirtualDisplays: false);

        Require(selected is null, "Selection must fail closed when no physical display is available.");
    }

    private static void UsesApprovedVisibilityEnvelope()
    {
        var minimum = OverlayTheme.AtPhase(0);
        var maximum = OverlayTheme.AtPhase(0.5);

        Require(minimum.BaseThickness == 30, "Minimum base thickness must be 30px.");
        Require(maximum.BaseThickness == 42, "Maximum base thickness must be 42px.");
        Require(minimum.FillAlpha == 0.24, "Minimum fill alpha must be 0.24.");
        Require(maximum.FillAlpha == 0.50, "Maximum fill alpha must be 0.50.");
    }

    private static void RendersSymmetricLuminanceOnAllFourEdges()
    {
        using var frame = OverlayRenderer.Render(new Size(320, 200), 0.25, null);
        var edgeSamples = new[] {
            frame.GetPixel(frame.Width / 2, 5),
            frame.GetPixel(frame.Width - 6, frame.Height / 2),
            frame.GetPixel(frame.Width / 2, frame.Height - 6),
            frame.GetPixel(5, frame.Height / 2),
        };

        Require(edgeSamples.All(color => color.ToArgb() == edgeSamples[0].ToArgb()), "Equivalent points on all four edges must have identical luminance and alpha.");
    }

    private static OverlayDisplayCandidate Candidate(
        string deviceName,
        Rectangle bounds,
        bool isPrimary = false,
        bool isForeground = false,
        bool isActive = true,
        bool isMirroring = false,
        bool isRemote = false,
        string deviceString = "Physical Display Adapter",
        string deviceId = "PCI\\DISPLAY\\0000",
        string deviceKey = "Physical Display Driver")
        => new(bounds, isPrimary, isForeground, isActive, isMirroring, isRemote, deviceName, deviceString, deviceId, deviceKey);

    private static void RendersClosedRiverThroughAllFourCorners()
    {
        using var frame = OverlayRenderer.Render(new Size(320, 200), 0.25, null);
        var cornerSamples = new[] {
            frame.GetPixel(5, 5),
            frame.GetPixel(frame.Width - 6, 5),
            frame.GetPixel(5, frame.Height - 6),
            frame.GetPixel(frame.Width - 6, frame.Height - 6),
        };

        Require(cornerSamples.All(color => color.A > 0), "The closed river must not leave transparent corner wedges.");
        for (var x = 0; x < frame.Width; x++)
        {
            Require(frame.GetPixel(x, 2).A > 0, $"The top river boundary is open at x={x}.");
            Require(frame.GetPixel(x, frame.Height - 3).A > 0, $"The bottom river boundary is open at x={x}.");
        }
        for (var y = 0; y < frame.Height; y++)
        {
            Require(frame.GetPixel(2, y).A > 0, $"The left river boundary is open at y={y}.");
            Require(frame.GetPixel(frame.Width - 3, y).A > 0, $"The right river boundary is open at y={y}.");
        }
        Require(frame.GetPixel(frame.Width / 2, frame.Height / 2).A == 0, "The overlay center must remain transparent.");
    }

    private static void RejectsNonPremultipliedFramesBeforeNativeAcquisition()
    {
        var native = new FakeNative();
        var bitmapFactory = new FakeBitmapFactory(native.Events);
        var exception = WithFrame(
            PixelFormat.Format32bppArgb,
            (window, frame) => ExpectException<ArgumentException>(() => CreatePresenter(native, bitmapFactory).Present(window, frame, Point.Empty)));

        Require(exception.ParamName == "frame", "PArgb validation must identify the frame argument.");
        RequireEvents(native.Events);
    }

    private static void HandlesAcquisitionFailuresWithoutRealNativeHandles()
    {
        var getDcFailure = new InvalidOperationException("GetDC failure");
        var getDcNative = new FakeNative { GetDcException = getDcFailure };
        var getDcFactory = new FakeBitmapFactory(getDcNative.Events);
        var getDcThrown = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<InvalidOperationException>(() => CreatePresenter(getDcNative, getDcFactory).Present(window, frame, Point.Empty)));

        Require(ReferenceEquals(getDcFailure, getDcThrown), "GetDC exceptions must remain presentation failures.");
        RequireEvents(getDcNative.Events, "GetDC");

        var missingScreenDcNative = new FakeNative { GetDcResult = IntPtr.Zero };
        var missingScreenDcFactory = new FakeBitmapFactory(missingScreenDcNative.Events);
        var missingScreenDcThrown = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<InvalidOperationException>(() => CreatePresenter(missingScreenDcNative, missingScreenDcFactory).Present(window, frame, Point.Empty)));

        Require(missingScreenDcThrown.Message == "GetDC failed.", "A null screen DC must be reported.");
        RequireEvents(missingScreenDcNative.Events, "GetDC");

        var missingMemoryDcNative = new FakeNative { CreateCompatibleDcResult = IntPtr.Zero };
        var missingMemoryDcFactory = new FakeBitmapFactory(missingMemoryDcNative.Events);
        var missingMemoryDcThrown = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<InvalidOperationException>(() => CreatePresenter(missingMemoryDcNative, missingMemoryDcFactory).Present(window, frame, Point.Empty)));

        Require(missingMemoryDcThrown.Message == "CreateCompatibleDC failed.", "A null memory DC must be reported.");
        RequireEvents(missingMemoryDcNative.Events, "GetDC", "CreateCompatibleDC", "ReleaseDC");

        var bitmapFailure = new InvalidOperationException("GetHbitmap failure");
        var bitmapNative = new FakeNative();
        var bitmapFactory = new FakeBitmapFactory(bitmapNative.Events) { Exception = bitmapFailure };
        var bitmapThrown = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<InvalidOperationException>(() => CreatePresenter(bitmapNative, bitmapFactory).Present(window, frame, Point.Empty)));

        Require(ReferenceEquals(bitmapFailure, bitmapThrown), "HBITMAP factory exceptions must remain presentation failures.");
        RequireEvents(bitmapNative.Events, "GetDC", "CreateCompatibleDC", "CreateHbitmap", "DeleteDC", "ReleaseDC");

        var missingBitmapNative = new FakeNative();
        var missingBitmapFactory = new FakeBitmapFactory(missingBitmapNative.Events) { Result = IntPtr.Zero };
        var missingBitmapThrown = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<InvalidOperationException>(() => CreatePresenter(missingBitmapNative, missingBitmapFactory).Present(window, frame, Point.Empty)));

        Require(missingBitmapThrown.Message == "GetHbitmap failed.", "A null HBITMAP must be reported.");
        RequireEvents(missingBitmapNative.Events, "GetDC", "CreateCompatibleDC", "CreateHbitmap", "DeleteDC", "ReleaseDC");

        var selectNative = new FakeNative { InitialSelectResult = new IntPtr(-1) };
        var selectFactory = new FakeBitmapFactory(selectNative.Events);
        var selectThrown = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<InvalidOperationException>(() => CreatePresenter(selectNative, selectFactory).Present(window, frame, Point.Empty)));

        Require(selectThrown.Message == "SelectObject failed.", "Initial SelectObject failure must be reported.");
        RequireEvents(selectNative.Events, "GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "DeleteDC", "DeleteObject", "ReleaseDC");
        Require(!selectNative.DeleteObjectBeforeMemoryDcWasGone, "HBITMAP deletion must wait for successful memory DC deletion.");
    }

    private static void ReportsFalsePresentationAfterOrderedCleanup()
    {
        var native = new FakeNative { UpdateLayeredWindowResult = false, UpdateLayeredWindowErrorCode = 5 };
        var bitmapFactory = new FakeBitmapFactory(native.Events);
        var exception = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<Win32Exception>(() => CreatePresenter(native, bitmapFactory).Present(window, frame, new Point(2, 3))));

        Require(exception.NativeErrorCode == 5, "UpdateLayeredWindow must report its captured Win32 error code.");
        Require(native.LastWindowHandle == FakeWindowHandle, "The harness must inject the window handle instead of creating one.");
        RequireEvents(native.Events, "GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC");
        Require(!native.DeleteObjectBeforeMemoryDcWasGone, "HBITMAP deletion must occur after the memory DC is gone.");
    }

    private static void PreservesPresentationExceptionsAcrossThrownCleanupOperations()
    {
        AssertPresentationSurvivesCleanupFailure(
            "restore",
            native => native.RestoreException = new InvalidOperationException("restore failure"),
            ["GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC"]);
        AssertPresentationSurvivesCleanupFailure(
            "DeleteDC",
            native => native.DeleteDcException = new InvalidOperationException("DeleteDC failure"),
            ["GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC"]);
        AssertPresentationSurvivesCleanupFailure(
            "DeleteObject",
            native => native.DeleteObjectException = new InvalidOperationException("DeleteObject failure"),
            ["GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC"]);
        AssertPresentationSurvivesCleanupFailure(
            "ReleaseDC",
            native => native.ReleaseDcException = new InvalidOperationException("ReleaseDC failure"),
            ["GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC"]);
    }

    private static void ReportsFalseCleanupOperationsAfterPresentationSucceeds()
    {
        AssertFalseCleanupFailure(
            "restore",
            native => native.RestoreResult = new IntPtr(99),
            "SelectObject failed while restoring the previous bitmap.",
            ["GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC"]);
        AssertFalseCleanupFailure(
            "DeleteDC",
            native => native.DeleteDcResult = false,
            "DeleteDC failed during cleanup.",
            ["GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC"]);
        AssertFalseCleanupFailure(
            "DeleteObject",
            native => native.DeleteObjectResult = false,
            "DeleteObject failed during cleanup.",
            ["GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC"]);
        AssertFalseCleanupFailure(
            "ReleaseDC",
            native => native.ReleaseDcResult = 0,
            "ReleaseDC failed during cleanup.",
            ["GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC"]);
    }

    private static void DeletesDeselectedBitmapWhenMemoryDcDestructionFails()
    {
        var falseDeleteDcNative = new FakeNative { DeleteDcResult = false };
        var falseDeleteDcFactory = new FakeBitmapFactory(falseDeleteDcNative.Events);
        var falseDeleteDcThrown = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<InvalidOperationException>(() => CreatePresenter(falseDeleteDcNative, falseDeleteDcFactory).Present(window, frame, Point.Empty)));

        Require(falseDeleteDcThrown.Message == "DeleteDC failed during cleanup.", "DeleteDC failure must remain the first cleanup error.");
        RequireEvents(falseDeleteDcNative.Events, "GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC");
        Require(falseDeleteDcNative.DeleteObjectBeforeMemoryDcWasGone, "The case must retain a live memory DC after DeleteDC fails.");
        Require(!falseDeleteDcNative.DeleteObjectBeforeBitmapWasDeselected, "A restored HBITMAP must be deleted even when the memory DC remains live.");

        var presentationFailure = new InvalidOperationException("presentation failure");
        var thrownDeleteDcNative = new FakeNative {
            UpdateLayeredWindowException = presentationFailure,
            DeleteDcException = new InvalidOperationException("DeleteDC failure"),
        };
        var thrownDeleteDcFactory = new FakeBitmapFactory(thrownDeleteDcNative.Events);
        var thrown = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<InvalidOperationException>(() => CreatePresenter(thrownDeleteDcNative, thrownDeleteDcFactory).Present(window, frame, Point.Empty)));

        Require(ReferenceEquals(presentationFailure, thrown), "DeleteDC exceptions must not mask the original presentation exception.");
        RequireEvents(thrownDeleteDcNative.Events, "GetDC", "CreateCompatibleDC", "CreateHbitmap", "SelectBitmap", "UpdateLayeredWindow", "RestoreBitmap", "DeleteDC", "DeleteObject", "ReleaseDC");
        Require(thrownDeleteDcNative.DeleteObjectBeforeMemoryDcWasGone, "The case must retain a live memory DC after DeleteDC throws.");
        Require(!thrownDeleteDcNative.DeleteObjectBeforeBitmapWasDeselected, "A restored HBITMAP must be deleted after DeleteDC throws.");
    }

    private static void AssertPresentationSurvivesCleanupFailure(
        string cleanupOperation,
        Action<FakeNative> configure,
        string[] expectedEvents)
    {
        var presentationFailure = new InvalidOperationException($"presentation failure before {cleanupOperation}");
        var native = new FakeNative { UpdateLayeredWindowException = presentationFailure };
        configure(native);
        var bitmapFactory = new FakeBitmapFactory(native.Events);
        var thrown = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<InvalidOperationException>(() => CreatePresenter(native, bitmapFactory).Present(window, frame, Point.Empty)));

        Require(ReferenceEquals(presentationFailure, thrown), $"{cleanupOperation} cleanup must not mask the presentation exception.");
        RequireEvents(native.Events, expectedEvents);
        Require(!native.DeleteObjectBeforeBitmapWasDeselected, $"{cleanupOperation} must not delete an HBITMAP before it is deselected.");
    }

    private static void AssertFalseCleanupFailure(
        string cleanupOperation,
        Action<FakeNative> configure,
        string expectedMessage,
        string[] expectedEvents)
    {
        var native = new FakeNative();
        configure(native);
        var bitmapFactory = new FakeBitmapFactory(native.Events);
        var thrown = WithFrame(
            PixelFormat.Format32bppPArgb,
            (window, frame) => ExpectException<InvalidOperationException>(() => CreatePresenter(native, bitmapFactory).Present(window, frame, Point.Empty)));

        Require(thrown.Message == expectedMessage, $"{cleanupOperation} must be reported when presentation succeeds.");
        RequireEvents(native.Events, expectedEvents);
        Require(!native.DeleteObjectBeforeBitmapWasDeselected, $"{cleanupOperation} must not delete an HBITMAP before it is deselected.");
    }

    private static LayeredWindowPresenter CreatePresenter(FakeNative native, FakeBitmapFactory bitmapFactory)
    {
        return new LayeredWindowPresenter(native, bitmapFactory, static _ => FakeWindowHandle);
    }

    private static T WithFrame<T>(PixelFormat pixelFormat, Func<Form, Bitmap, T> action)
    {
        using var window = new Form();
        using var frame = new Bitmap(1, 1, pixelFormat);
        var result = action(window, frame);
        Require(!window.IsHandleCreated, "The harness must not create a real window handle.");
        return result;
    }

    private static T ExpectException<T>(Action action) where T : Exception
    {
        try
        {
            action();
        }
        catch (T exception)
        {
            return exception;
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException($"Expected {typeof(T).Name}, but Present threw {exception.GetType().Name}.", exception);
        }

        throw new InvalidOperationException($"Expected {typeof(T).Name}, but Present returned successfully.");
    }

    private static void RequireEvents(IReadOnlyList<string> actual, params string[] expected)
    {
        if (actual.SequenceEqual(expected)) return;

        throw new InvalidOperationException($"Expected [{string.Join(", ", expected)}], got [{string.Join(", ", actual)}].");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private sealed class FakeBitmapFactory : ILayeredWindowBitmapFactory
    {
        private readonly List<string> _events;

        public FakeBitmapFactory(List<string> events)
        {
            _events = events;
        }

        public IntPtr Result { get; set; } = FakeBitmapHandle;
        public Exception? Exception { get; set; }

        public IntPtr CreateHbitmap(Bitmap frame)
        {
            _events.Add("CreateHbitmap");
            if (Exception is not null) throw Exception;
            return Result;
        }
    }

    private sealed class FakeNative : ILayeredWindowNative
    {
        private bool _memoryDcLive;
        private bool _bitmapSelected;

        public List<string> Events { get; } = [];
        public IntPtr GetDcResult { get; set; } = FakeScreenDc;
        public Exception? GetDcException { get; set; }
        public IntPtr CreateCompatibleDcResult { get; set; } = FakeMemoryDc;
        public Exception? CreateCompatibleDcException { get; set; }
        public IntPtr InitialSelectResult { get; set; } = FakePreviousBitmap;
        public Exception? InitialSelectException { get; set; }
        public IntPtr RestoreResult { get; set; } = FakeBitmapHandle;
        public Exception? RestoreException { get; set; }
        public bool UpdateLayeredWindowResult { get; set; } = true;
        public int UpdateLayeredWindowErrorCode { get; set; }
        public Exception? UpdateLayeredWindowException { get; set; }
        public bool DeleteDcResult { get; set; } = true;
        public Exception? DeleteDcException { get; set; }
        public bool DeleteObjectResult { get; set; } = true;
        public Exception? DeleteObjectException { get; set; }
        public int ReleaseDcResult { get; set; } = 1;
        public Exception? ReleaseDcException { get; set; }
        public IntPtr LastWindowHandle { get; private set; }
        public bool DeleteObjectBeforeMemoryDcWasGone { get; private set; }
        public bool DeleteObjectBeforeBitmapWasDeselected { get; private set; }

        public IntPtr GetDC()
        {
            Events.Add("GetDC");
            if (GetDcException is not null) throw GetDcException;
            return GetDcResult;
        }

        public int ReleaseDC(IntPtr screenDc)
        {
            Events.Add("ReleaseDC");
            if (ReleaseDcException is not null) throw ReleaseDcException;
            return ReleaseDcResult;
        }

        public IntPtr CreateCompatibleDC(IntPtr screenDc)
        {
            Events.Add("CreateCompatibleDC");
            if (CreateCompatibleDcException is not null) throw CreateCompatibleDcException;
            _memoryDcLive = CreateCompatibleDcResult != IntPtr.Zero;
            return CreateCompatibleDcResult;
        }

        public IntPtr SelectObject(IntPtr memoryDc, IntPtr gdiObject)
        {
            if (!_bitmapSelected)
            {
                Events.Add("SelectBitmap");
                if (InitialSelectException is not null) throw InitialSelectException;
                if (InitialSelectResult != IntPtr.Zero && InitialSelectResult != new IntPtr(-1)) _bitmapSelected = true;
                return InitialSelectResult;
            }

            Events.Add("RestoreBitmap");
            if (RestoreException is not null) throw RestoreException;
            if (RestoreResult == FakeBitmapHandle) _bitmapSelected = false;
            return RestoreResult;
        }

        public bool DeleteObject(IntPtr gdiObject)
        {
            Events.Add("DeleteObject");
            DeleteObjectBeforeMemoryDcWasGone |= _memoryDcLive;
            DeleteObjectBeforeBitmapWasDeselected |= _memoryDcLive && _bitmapSelected;
            if (DeleteObjectException is not null) throw DeleteObjectException;
            return DeleteObjectResult;
        }

        public bool DeleteDC(IntPtr memoryDc)
        {
            Events.Add("DeleteDC");
            if (DeleteDcException is not null) throw DeleteDcException;
            if (DeleteDcResult) _memoryDcLive = false;
            return DeleteDcResult;
        }

        public bool UpdateLayeredWindow(IntPtr windowHandle, IntPtr screenDc, Point screenLocation, Size size, IntPtr memoryDc, out int errorCode)
        {
            Events.Add("UpdateLayeredWindow");
            LastWindowHandle = windowHandle;
            errorCode = UpdateLayeredWindowErrorCode;
            if (UpdateLayeredWindowException is not null) throw UpdateLayeredWindowException;
            return UpdateLayeredWindowResult;
        }
    }
}
