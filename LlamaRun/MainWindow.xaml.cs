//using CPythonIntrop;
using Microsoft.UI;
using Microsoft.UI.Input;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using ModelContextProtocol;
using ModelContextProtocol.Client;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
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
            //SetTitleBar(AppTitleBar); 

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
            MoveAndResizeWindow(0.5, 0.5);

            //PopulateServerComboBox();
        }

        public async void AppTitleBar_Loaded(Object _, RoutedEventArgs e)
        {
            String appHeight = SettingsWindow.LoadSetting("Height");
            String appWidth = SettingsWindow.LoadSetting("Width");
            if (appHeight == String.Empty || appWidth == String.Empty)
            {
                // 50% of the work area width and 50% of the work area height
                MoveAndResizeWindow(50 / 100.0, 50 / 100.0);
            }
            else
            {
                MoveAndResizeWindow(int.Parse(appWidth) / 100.0, int.Parse(appHeight) / 100.0);
            }

            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);


            RegisterGlobalHotkey(hwnd);

            AddTrayIcon(hwnd);
            SubclassWndProc(hwnd);

            AIServiceManager.GetInstance().SetMainWindowPtr(this);
            await AIServiceManager.GetInstance().LoadModels();
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
            int centerY = workArea.Y + (workArea.Height * 1 / 2);

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

                    LLMResponse.Clear();
                    MarkdownTextBlock1.Text = null;

                    //await PluginManagerIntrop.BroadcastEvent("beforeTextGeneration");

                    TextBoxElement.IsReadOnly = true;
                    StartSkeletonLoadingAnimation();

                    // MCP Client
                    try
                    {
                        var getTools = await SettingsWindow.LoadMCPServerData();
                        DataStore.GetInstance().SetMCPServers(getTools);
                        //TODO: Should Parse at App Startup, but will work for now.
                        IList<McpClientTool> tools = [];
                        foreach (var item in DataStore.GetInstance().GetMCPServers())
                        {
                            try
                            {
                                var tool = await (await McpClientFactory.CreateAsync(
                                    new StdioClientTransport(new StdioClientTransportOptions
                                    {
                                        Name = item.Name,
                                        Command = item.Data.Command ?? String.Empty,
                                        Arguments = item.Data.Arguments,
                                        EnvironmentVariables = item.Data.EnvironmentVariables
                                    }))).ListToolsAsync();
                                tools = [.. tools, .. tool.ToList()];
                            }
                            //Continue with other Servers
                            catch (McpException ex)
                            {
                                Debug.WriteLine(ex.Message + " Link = " + ex.HelpLink);
                                continue;
                            }
                            catch (Exception ex)
                            {
                                Debug.WriteLine(ex.Message + " Link = " + ex.HelpLink);
                                continue;
                            }
                        }

                        await Task.Run(
                            async () =>
                            {
                                try
                                {
                                    string modelName = DataStore.GetInstance().GetSelectedModel();

                                    var modelObject = AIServiceManager.IsModelCloudBased(modelName)
                                    ? CloudLLMService.GetModels()[DataStore.GetInstance().LoadSelectedModel().GetSelectedModel()]
                                    : new Model(modelName, [Capabilities.Text]);

                                    await AIServiceManager.GetInstance().TextGeneration(
                                            modelObject,
                                            inputText,
                                            [.. tools]
                                        );
                                }
                                catch (IOException ex)
                                {
                                    System.Diagnostics.Trace.WriteLine($"GENERAL ERROR: {ex.GetType().FullName}");
                                    System.Diagnostics.Trace.WriteLine($"Message: {ex.Message}");
                                    System.Diagnostics.Trace.WriteLine($"HRESULT: {ex.HResult:X8}");
                                    System.Diagnostics.Trace.WriteLine($"Stack: {ex.StackTrace}");
                                    throw;
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

                    }
                    catch (McpException ex)
                    {
                        Debug.WriteLine(ex.Message + " Link = " + ex.HelpLink);
                        StopSkeletonLoadingAnimation();
                        textBox.IsReadOnly = false;
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine(ex.Message + " Link = " + ex.HelpLink);

                        StopSkeletonLoadingAnimation();
                        textBox.IsReadOnly = false;
                    }
                    //PluginManager.GetInstance().BroadcastEvent("afterTextGeneration");
                }
            }
        }

        readonly StringBuilder LLMResponse = new();

        public void UpdateTextBox(string text)
        {
            try
            {
                LLMResponse.Append(text);
                // No need to check for null text, the calling code now sends an empty string.

                // TryEnqueue returns false if the UI thread is shutting down or unavailable.
                bool successfullyEnqueued = DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Normal, async () =>
                {
                    // Add a final check here. The control could have become null
                    // by the time this code runs on the UI thread.
                    if (MarkdownTextBlock1 != null)
                    {
                        MarkdownTextBlock1.Text = LLMResponse.ToString();
                    }
                });

                if (!successfullyEnqueued)
                {
                    // Use a logging mechanism that works in Release mode to see this error.
                    System.Diagnostics.Trace.WriteLine("Failed to enqueue UI update. The dispatcher queue may be shutting down.");
                }
            }
            catch (Exception ex)
            {
                // IMPORTANT: Use Trace.WriteLine or a proper logging library (e.g., Serilog).
                // This will now show up in your Release build's output window.
                System.Diagnostics.Trace.WriteLine($"Exception in UpdateTextBox: {ex.Message}");
            }
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

        //private void PopulateServerComboBox()
        //{
        //    // In a real application, you would load this list dynamically
        //    // from a configuration file, a network request, etc.
        //    List<string> servers =
        //    [
        //        "mcp.example.com:25565",
        //        "anothermcp.server.net",
        //        "local.server:12345"
        //    ];

        //    foreach (var serverName in servers)
        //    {
        //        var menuItem = new MenuFlyoutItem
        //        {
        //            Text = serverName,
        //            Tag = serverName
        //        };

        //        ServerComboBox.Items.Add(menuItem);
        //    }

        //    // Optionally set a default selected item
        //    //if (servers.Count > 0)
        //    //{
        //    //    ServerComboBox.Items = 0;
        //    //}
        //}

        //private string? _selectedMcpServer;
        //public string? SelectedMcpServer
        //{
        //    get => _selectedMcpServer;
        //    set
        //    {
        //        if (_selectedMcpServer != value)
        //        {
        //            _selectedMcpServer = value;
        //            // TODO: Add logic here to connect to the new server
        //            // This is where you would initiate the connection based on the selection.
        //            MarkdownTextBlock1.Text = $"Selected MCP Server: {_selectedMcpServer}";
        //            System.Diagnostics.Debug.WriteLine($"Selected MCP Server: {_selectedMcpServer}");
        //        }
        //    }
        //}

        //// Event handler for when the selected server in the ComboBox changes
        //private void ServerComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        //{
        //    if (ServerComboBox.SelectedItem != null)
        //    {
        //        SelectedMcpServer = ServerComboBox.SelectedItem.ToString()!;
        //    }
        //    else
        //    {
        //        SelectedMcpServer = null;
        //    }
        //}

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

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr CallWindowProc(IntPtr lpPrevWndFunc, IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

        [DllImport("comctl32.dll", SetLastError = true)]
        private static extern bool SetWindowSubclass(IntPtr hWnd, SUBCLASSPROC pfnSubclass, IntPtr uIdSubclass, IntPtr dwRefData);

        [DllImport("comctl32.dll", SetLastError = true)]
        private static extern IntPtr DefSubclassProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

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
            try
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
            }
            catch (Win32Exception w)
            {
                Console.WriteLine(w.Message);
                Console.WriteLine(w.ErrorCode.ToString());
                Console.WriteLine(w.NativeErrorCode.ToString());
                Console.WriteLine(w.StackTrace);
                Console.WriteLine(w.Source);
                Exception e = w.GetBaseException();
                Console.WriteLine(e.Message);
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
