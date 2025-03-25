using Microsoft.UI;
using Microsoft.UI.Input;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Windows.Graphics;
using Windows.System;
using Windows.UI.Core;
using WinRT;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun
{
    /// <summary>
    /// An empty window that can be used on its own or navigated to within a Frame.
    /// </summary>
    public sealed partial class MainWindow : Window
    {
        public MainWindow()
        {
            this.InitializeComponent();

            ExtendsContentIntoTitleBar = true;
            //SetTitleBar(AppTitleBar);  //Assuming you have a XAML element named AppTitleBar

            // AppWindow configuration
            var appWindow = GetAppWindowForCurrentWindow();
            var presenter = appWindow.Presenter as OverlappedPresenter;
            presenter!.IsMaximizable = false;
            presenter!.IsMinimizable = false;
            presenter!.IsResizable = true;
            presenter!.SetBorderAndTitleBar(true, false);
            presenter!.IsAlwaysOnTop = true;
            appWindow.IsShownInSwitchers = false;

            // Initial size/positioning
            MoveAndResizeWindow(0.38, 0.10); // Default values
        }

        public async void AppTitleBar_Loaded(Object _, RoutedEventArgs e)
        {
            String appHeight = SettingsWindow.LoadSetting("Height");
            String appWidth = SettingsWindow.LoadSetting("Width");
            if (appHeight == "" || appWidth == "")
            {
                // 38% of the work area width and 10% of the work area height
                MoveAndResizeWindow(38 / 100.0, 10 / 100.0);
            }
            else
            {
                MoveAndResizeWindow(int.Parse(appWidth) / 100.0, int.Parse(appHeight) / 100.0);
            }

            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);

            AddTrayIcon(hwnd);
            SubclassWndProc(hwnd);
            RegisterGlobalHotkey(hwnd);

            AIServiceManager.GetInstance().SetMainWindowPtr(this);
            DataStore.GetInstance().LoadModelService();
            if (DataStore.GetInstance().GetModelService() == "Ollama" || DataStore.GetInstance().GetModelService() == "")
            {
                AIServiceManager.GetInstance().SetActiveServiceByName("Ollama");
                await AIServiceManager.GetInstance().LoadModels();
            }
            else if (DataStore.GetInstance().GetModelService() == "Google Gemini")
            {
                AIServiceManager.GetInstance().SetActiveServiceByName("Google Gemini");
                await AIServiceManager.GetInstance().LoadModels();
                Debug.WriteLine("Google Gemini");
            }
        }

        private AppWindow GetAppWindowForCurrentWindow()
        {
            var hWnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            WindowId windowId = Win32Interop.GetWindowIdFromWindow(hWnd);
            return AppWindow.GetFromWindowId(windowId);
        }

        public void MoveAndResizeWindow(double widthPercentage, double heightPercentage)
        {
            var appWindow = GetAppWindowForCurrentWindow();
            var displayArea = DisplayArea.GetFromWindowId(appWindow.Id, DisplayAreaFallback.Primary);
            var workArea = displayArea.WorkArea;

            int windowWidth = (int)(workArea.Width * widthPercentage);
            int windowHeight = (int)(workArea.Height * heightPercentage);

            int centerX = workArea.X + (workArea.Width / 2);
            int centerY = workArea.Y + (workArea.Height * 1 / 3);

            appWindow.MoveAndResize(new RectInt32(centerX - (windowWidth / 2), centerY - (windowHeight / 2), windowWidth, windowHeight));
        }

        public void StartSkeletonLoadingAnimation()
        {

            LoadingStoryBoard.Begin();
        }

        public void StopSkeletonLoadingAnimation()
        {
            BackgroundBrush.Opacity = 0;
            LoadingStoryBoard.Stop();
        }

        void ShowTrayMenu()
        {
            Window settingsWindow = new SettingsWindow();
            settingsWindow.Activate();
        }

        public async void TextBoxElement_PreviewKeyDown(Object sender, KeyRoutedEventArgs e)
        {
            var textBox = sender.As<TextBox>();

            if (textBox.IsReadOnly)
            {
                return;
            }

            if (e.Key == VirtualKey.Enter)
            {
                var keyboard = InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift);

                if (keyboard.HasFlag(CoreVirtualKeyStates.Down))
                {
                    e.Handled = true; // Prevent TextBox from inserting *another* newline

                    // Shift+Enter: Insert newline MANUALLY and prevent default handling
                    textBox.DispatcherQueue.TryEnqueue(() =>
                    {
                        int caretPosition = textBox.SelectionStart;
                        // string currentText = textBox.Text ?? ""; // Not needed with SelectedText
                        // caretPosition = Math.Min(caretPosition, currentText.Length); // Not needed

                        // textBox.Text = currentText.Insert(caretPosition, Environment.NewLine); // OLD
                        // Use SelectedText instead of Text.Insert()
                        textBox.SelectedText = Environment.NewLine;

                        // Move caret *after* a short delay
                        textBox.SelectionStart = caretPosition + Environment.NewLine.Length;
                    });
                }
                else
                {
                    string inputText = textBox.Text;
                    string model = DataStore.GetInstance().GetSelectedModel();

                    res = "";

                    //PluginManager.GetInstance().BroadcastEvent("beforeTextGeneration");

                    TextBoxElement.IsReadOnly = true;
                    StartSkeletonLoadingAnimation();

                    await Task.Run(
                        async () =>
                        {
                            try
                            {
                                await AIServiceManager.GetInstance().TextGeneration(DataStore.GetInstance().LoadSelectedModel().GetSelectedModel(), inputText);
                            }
                            catch (Exception ex)
                            {
                                // Handle exceptions from Response Generation
                                Debug.WriteLine(ex);
                                DispatcherQueue.TryEnqueue(() =>
                                {
                                    TextBoxElement.Text = null;
                                    TextBoxElement.PlaceholderText = ("Error: " + ex.Message);
                                    TextBoxElement.IsReadOnly = false;
                                    StopSkeletonLoadingAnimation();
                                });
                            }
                        }
                    );

                    //PluginManager.GetInstance().BroadcastEvent("afterTextGeneration");
                }
            }
        }

        public void UpdateTextBox(String text)
        {
            res += text;
            TextBoxElement.Text = res;
        }

        void TextBoxElement_TextChanged(Object _, TextChangedEventArgs __)
        {
            //scrollViewer.ChangeView(null, scrollViewer.ScrollableHeight, null, true);
            /*if (sender.as<Microsoft::UI::Xaml::Controls::TextBox>().Text() == L"")
            {
                MoveAndResizeWindow(0.3f, 0.08f);
            }*/

            //scrollViewer.DispatcherQueue.TryEnqueue(() =>
            //{
            //    // Only scroll if the user is already near the bottom
            //    //if (scrollViewer.VerticalOffset >= scrollViewer.ScrollableHeight - scrollViewer.ViewportHeight - 1000) // 50 is a threshold
            //    //{
            //    //    scrollViewer.ChangeView(null, scrollViewer.ScrollableHeight, null, false);
            //    //}
            //    scrollViewer.ChangeView(null, scrollViewer.ScrollableHeight, null, false);

            //});
        }

        void SetFocusOnTextBox()
        {
            Microsoft.UI.Xaml.FocusState key = FocusState.Keyboard;
            TextBoxElement.Focus(key);
        }

        #region TrayIcon

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NOTIFYICONDATA
        {
            public int cbSize;
            public IntPtr hWnd;
            public uint uID;
            public uint uFlags;
            public uint uCallbackMessage;
            public IntPtr hIcon;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string szTip;
            public uint dwState;
            public uint dwStateMask;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
            public string szInfo;
            public uint uVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string szInfoTitle;
            public uint dwInfoFlags;
        }

        private const int NIF_MESSAGE = 0x00000001;
        private const int NIF_ICON = 0x00000002;
        private const int NIF_TIP = 0x00000004;
        private const int NIM_ADD = 0x00000000;
        private const int WM_TRAYICON = 0x8000;
        private const uint IMAGE_ICON = 1;
        private const uint LR_LOADFROMFILE = 0x00000010;

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern bool Shell_NotifyIcon(uint dwMessage, ref NOTIFYICONDATA lpData);

        // Importing LoadImage function from user32.dll to load the icon
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadImage(IntPtr hInst, string lpszName, uint uType, int cxDesired, int cyDesired, uint fuLoad);

        private void AddTrayIcon(IntPtr hwnd)
        {
            NOTIFYICONDATA nid = new NOTIFYICONDATA();
            nid.cbSize = Marshal.SizeOf(nid);
            nid.hWnd = hwnd;
            nid.uID = 1;
            nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
            nid.uCallbackMessage = WM_TRAYICON;

            // Load the icon from the file
            IntPtr hIcon = LoadImage(hwnd, "Assets/LlamaRun.ico", IMAGE_ICON, 0, 0, LR_LOADFROMFILE);
            nid.hIcon = hIcon;
            nid.szTip = "Llama Run";

            // Add the icon to the system tray
            Shell_NotifyIcon(NIM_ADD, ref nid);
        }
        #endregion

        #region Window SubClass
        private static nint originalWndProc;
        public string? res = "";

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr CallWindowProc(IntPtr lpPrevWndFunc, IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

        [DllImport("comctl32.dll", SetLastError = true)]
        private static extern bool SetWindowSubclass(IntPtr hWnd, SUBCLASSPROC pfnSubclass, IntPtr uIdSubclass, IntPtr dwRefData);

        private delegate IntPtr SUBCLASSPROC(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, IntPtr uIdSubclass, IntPtr dwRefData);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

        private const int GWLP_WNDPROC = -4;
        private const uint WM_HOTKEY = 0x0312;
        private const uint WM_CLOSE = 0x0010;
        private const uint WM_ACTIVATE = 0x0006;
        private const int WA_INACTIVE = 0;
        private const int WM_LBUTTONDOWN = 0x0201;

        // Custom WndProc function to handle messages
        private static IntPtr CustomWndProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, IntPtr uIdSubclass, IntPtr dwRefData)
        {
            GCHandle handle = GCHandle.FromIntPtr(dwRefData);
            MainWindow? pThis = (MainWindow?)handle.Target;

            switch (uMsg)
            {
                case WM_HOTKEY:
                    if (pThis != null)
                    {
                        if (!pThis.Visible)
                        {
                            pThis.SetFocusOnTextBox();

                            //var AppDimension = DataStore.GetInstance().GetAppDimension();
                            //pThis.MoveAndResizeWindow(AppDimension.X / 100.0, AppDimension.Y / 100.0);

                            var AppOpacity = DataStore.GetInstance().GetAppOpacity();
                            pThis.OpacityDoubleAnimation.To = (AppOpacity / 100.0);
                            // Window is hidden, so show it
                            ShowWindow(hWnd, SW_SHOW);
                            SetForegroundWindow(hWnd);
                        }
                        else
                        {
                            // Window is visible, so hide it
                            ShowWindow(hWnd, SW_HIDE);
                        }
                    }
                    break;
                case WM_CLOSE:
                    ShowWindow(hWnd, SW_HIDE);
                    return 0;
                case WM_TRAYICON:
                    if (lParam == WM_LBUTTONDOWN)
                    {
                        // Tray icon was clicked
                        Debug.WriteLine("Tray icon clicked\n");
                        pThis?.ShowTrayMenu();
                    }
                    break;
                case WM_ACTIVATE:
                    if (wParam == WA_INACTIVE)
                    {
                        ShowWindow(hWnd, SW_HIDE);
                    }

                    break;
            }
            return CallWindowProc(originalWndProc, hWnd, uMsg, wParam, lParam);

        }

        // Subclass the WndProc
        private void SubclassWndProc(nint hwnd)
        {
            originalWndProc = GetWindowLongPtr(hwnd, GWLP_WNDPROC);

            GCHandle handle = GCHandle.Alloc(this);
            IntPtr ptr = GCHandle.ToIntPtr(handle);

            SetWindowSubclass(hwnd, CustomWndProc, IntPtr.Zero, ptr);
        }
        private const int SW_HIDE = 0;
        private const int SW_SHOW = 5;

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);
        #endregion

        #region HotKey
        private const int MOD_CONTROL = 0x0002;
        private const int MOD_SHIFT = 0x0004;
        private const int HOTKEY_ID = 1;
        private const int VK_A = 0x41;  // Virtual key code for 'A'

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);

        private const uint MB_OK = 0x00000000;
        private const uint MB_ICONERROR = 0x00000010;

        void RegisterGlobalHotkey(IntPtr hwnd)
        {
            if (!RegisterHotKey(hwnd, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT, VK_A))  // Ctrl + Shift + A
            {
                _ = MessageBox((nint)null, "Failed to register hotkey", "Error", MB_OK | MB_ICONERROR);
            }
            else
            {
                //MessageBox(nullptr, L"Hotkey registered!", L"Success", MB_OK);
            }
        }

        void UnregisterGlobalHotkey(IntPtr hwnd)
        {
            UnregisterHotKey(hwnd, 1);
        }
        #endregion
    }
}
