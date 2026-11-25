using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;
using System.Windows.Forms;
using Windows.ApplicationModel.DataTransfer;
using Windows.Foundation;
using Windows.Storage;

[ComImport]
[Guid("3A3DCD6C-3EAB-43DC-BCDE-45671CE800C8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDataTransferManagerInterop
{
    IntPtr GetForWindow([In] IntPtr appWindow, [In] ref Guid riid);
    void ShowShareUIForWindow([In] IntPtr appWindow);
}

class Program
{
    [DllImport("combase.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    public static extern void RoGetActivationFactory(
        [MarshalAs(UnmanagedType.HString)] string activatableClassId,
        [In] ref Guid iid,
        [Out, MarshalAs(UnmanagedType.IUnknown)] out object factory
    );

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            return 1;
        }

        string filePath = Path.GetFullPath(args[0]);
        if (!File.Exists(filePath))
        {
            return 2;
        }

        string title = args.Length > 1 && !string.IsNullOrWhiteSpace(args[1])
            ? args[1]
            : Path.GetFileNameWithoutExtension(filePath);

        // Grant ALL APPLICATION PACKAGES (S-1-15-2-1) read permissions
        // so UWP / Microsoft Store apps like WhatsApp Desktop can read the file
        try
        {
            var fileInfo = new FileInfo(filePath);
            var security = fileInfo.GetAccessControl();
            var appPackagesSid = new SecurityIdentifier("S-1-15-2-1"); // ALL APPLICATION PACKAGES
            security.AddAccessRule(new FileSystemAccessRule(
                appPackagesSid,
                FileSystemRights.ReadAndExecute | FileSystemRights.Read,
                AccessControlType.Allow
            ));
            fileInfo.SetAccessControl(security);
        }
        catch {}

        // Also place file on clipboard as FileDropList as a seamless convenience
        try
        {
            var dropList = new System.Collections.Specialized.StringCollection();
            dropList.Add(filePath);
            System.Windows.Forms.Clipboard.SetFileDropList(dropList);
        }
        catch {}

        Form helperForm = new Form();
        helperForm.FormBorderStyle = FormBorderStyle.None;
        helperForm.ShowInTaskbar = false;
        helperForm.Opacity = 0;
        helperForm.Size = new System.Drawing.Size(1, 1);
        helperForm.StartPosition = FormStartPosition.CenterScreen;
        helperForm.Show();
        IntPtr hwnd = helperForm.Handle;

        try
        {
            Guid iidInterop = new Guid("3A3DCD6C-3EAB-43DC-BCDE-45671CE800C8");
            object factoryObj;
            RoGetActivationFactory("Windows.ApplicationModel.DataTransfer.DataTransferManager", ref iidInterop, out factoryObj);
            IDataTransferManagerInterop interop = (IDataTransferManagerInterop)factoryObj;

            Guid iidDtm = new Guid("a5caee9b-8708-49d1-8d36-67d25a8da00c");
            IntPtr dtmPtr = interop.GetForWindow(hwnd, ref iidDtm);
            DataTransferManager dtm;
            try
            {
                dtm = (DataTransferManager)Marshal.GetObjectForIUnknown(dtmPtr);
            }
            finally
            {
                if (dtmPtr != IntPtr.Zero) Marshal.Release(dtmPtr);
            }

            bool targetChosen = false;
            DateTime targetChosenTime = DateTime.MinValue;

            dtm.DataRequested += (sender, e) =>
            {
                DataRequestDeferral deferral = e.Request.GetDeferral();
                try
                {
                    e.Request.Data.Properties.Title = title;
                    e.Request.Data.Properties.Description = "Invoice PDF";
                    
                    // Share strictly the PDF file itself as requested, not any message
                    IAsyncOperation<StorageFile> op = StorageFile.GetFileFromPathAsync(filePath);
                    while (op.Status == AsyncStatus.Started)
                    {
                        Thread.Sleep(10);
                    }
                    StorageFile sFile = op.GetResults();

                    List<IStorageItem> items = new List<IStorageItem>();
                    items.Add(sFile);
                    e.Request.Data.SetStorageItems(items, true);
                }
                catch
                {
                    e.Request.FailWithDisplayText("Error attaching invoice PDF.");
                }
                finally
                {
                    deferral.Complete();
                }
            };

            dtm.TargetApplicationChosen += (sender, e) =>
            {
                // CRITICAL FIX: Do NOT exit immediately!
                // Target apps (like WhatsApp Desktop) run in an AppContainer sandbox and require time
                // to communicate through the Windows broker and read the StorageItem payload.
                targetChosen = true;
                targetChosenTime = DateTime.Now;
            };

            SetForegroundWindow(hwnd);
            interop.ShowShareUIForWindow(hwnd);

            DateTime startTime = DateTime.Now;
            System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
            timer.Interval = 500;
            timer.Tick += (s, e) =>
            {
                double elapsedTotal = (DateTime.Now - startTime).TotalSeconds;
                if (targetChosen)
                {
                    // Allow 30 seconds after target app is chosen for the file stream to be consumed by WhatsApp
                    double elapsedSinceChosen = (DateTime.Now - targetChosenTime).TotalSeconds;
                    if (elapsedSinceChosen > 30)
                    {
                        timer.Stop();
                        if (helperForm != null) helperForm.Close();
                        Application.Exit();
                    }
                }
                else if (elapsedTotal > 180) // 3 minutes timeout if no app is selected
                {
                    timer.Stop();
                    if (helperForm != null) helperForm.Close();
                    Application.Exit();
                }
            };
            timer.Start();

            Application.Run();
            return 0;
        }
        catch
        {
            return 3;
        }
        finally
        {
            if (helperForm != null && !helperForm.IsDisposed)
            {
                helperForm.Dispose();
            }
        }
    }
}
