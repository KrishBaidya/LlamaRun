#include "pch.h"
#include "MainWindow.xaml.h"
#if __has_include("MainWindow.g.cpp")
#include "MainWindow.g.cpp"
#endif

#include <DataStore.cpp>
#include <PluginManager.h>
#include <AIServiceManager.h>

using namespace winrt;
using namespace Microsoft::UI;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Input;
using namespace Microsoft::UI::Windowing;
using namespace Windows::UI::ViewManagement;
using namespace Windows::ApplicationModel::AppService;
using namespace winrt::Windows::Foundation::Collections;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Xaml::Media;
using namespace Microsoft::UI::Xaml::Media::Animation;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

#include <SettingsWindow.xaml.h>
#include "VSCodeConnector.h"
#include <ShowOllamaUnavaliableWindow.h>

namespace winrt::LlamaRun::implementation
{
	static WNDPROC originalWndProc;

	static LRESULT CALLBACK CustomWndProc(HWND hWnd, UINT uMsg, WPARAM wParam, LPARAM lParam, UINT_PTR uIdSubclass, DWORD_PTR dwRefData)
	{
		MainWindow* pThis = reinterpret_cast<MainWindow*>(dwRefData);

		switch (uMsg)
		{
		case WM_HOTKEY:
			if (!IsWindowVisible(hWnd))
			{
				VSCodeConnector::GetInstance().SaveLastActiveWindow();

				if (pThis) {
					pThis->SetFocusOnTextBox();

					auto AppDimension = DataStore::GetInstance().GetAppDimension();
					pThis->MoveAndResizeWindow(AppDimension.X / 100.0, AppDimension.Y / 100.0);

					auto AppOpacity = DataStore::GetInstance().GetAppOpacity();
					pThis->OpacityDoubleAnimation().To(AppOpacity / 100.0);
				}

				// Window is hidden, so show it
				ShowWindow(hWnd, SW_SHOW);
				SetForegroundWindow(hWnd);

			}
			else
			{
				// Window is visible, so hide it
				ShowWindow(hWnd, SW_HIDE);
			}
			break;
		case WM_CLOSE:
			ShowWindow(hWnd, SW_HIDE);
			return 0;
		case WM_TRAYICON:
			if (lParam == WM_LBUTTONDOWN) {
				// Tray icon was clicked
				OutputDebugString(L"Tray icon clicked\n");
				if (pThis)
				{
					pThis->ShowTrayMenu();
				}
			}
			break;
		case WM_ACTIVATE:
			if (LOWORD(wParam) == WA_INACTIVE)
			{
				ShowWindow(hWnd, SW_HIDE);
			}

			break;
		}
		return CallWindowProc(originalWndProc, hWnd, uMsg, wParam, lParam);
	}

	MainWindow::MainWindow()
	{
		Title(L"Llama Run");

		// Extend content into the title bar
		ExtendsContentIntoTitleBar(true);

		auto const& appWindow = AppWindow();
		auto const& presenter = appWindow.Presenter().as<OverlappedPresenter>();

		presenter.IsMaximizable(false);
		presenter.IsMinimizable(false);
		presenter.IsResizable(false);
		presenter.SetBorderAndTitleBar(true, false);

		presenter.IsAlwaysOnTop(true);
		appWindow.IsShownInSwitchers(false);
	}

	void MainWindow::SubclassWndProc(HWND const& hwnd)
	{
		// Store the original window procedure
		originalWndProc = (WNDPROC)GetWindowLongPtr(hwnd, GWLP_WNDPROC);

		SetWindowSubclass(hwnd, CustomWndProc, 0, reinterpret_cast<DWORD_PTR>(this)); // Set user data first

		// Subclass the window procedure
		//SetWindowLongPtr(hwnd, GWLP_WNDPROC, (LONG_PTR)CustomWndProc);
	}

	int32_t MainWindow::MyProperty()
	{
		throw hresult_not_implemented();
	}

	void MainWindow::MyProperty(int32_t /* value */)
	{
		throw hresult_not_implemented();
	}

	void MainWindow::StartSkeletonLoadingAnimation()
	{
		LoadingStoryBoard().Begin();
	}

	void MainWindow::StopSkeletonLoadingAnimation()
	{
		BackgroundBrush().Opacity(0);
		LoadingStoryBoard().Stop();
	}

	void MainWindow::AppTitleBar_Loaded(IInspectable const&, RoutedEventArgs const&)
	{
		const hstring& appHeight = SettingsWindow::LoadSetting("App Height");
		const hstring& appWidth = SettingsWindow::LoadSetting("App Width");
		if (appHeight == to_hstring("") || appWidth == to_hstring(""))
		{
			// 38% of the work area width and 10% of the work area height
			MoveAndResizeWindow(38 / 100.0, 10 / 100.0);
		}
		else
		{
			MoveAndResizeWindow(std::stoi(to_string(appWidth)) / 100.0, std::stoi(to_string(appHeight)) / 100.0);
		}

		auto& windowNative{ this->m_inner.as<::IWindowNative>() };
		HWND hwnd{ 0 };
		windowNative->get_WindowHandle(&hwnd);

		AddTrayIcon(hwnd);
		SubclassWndProc(hwnd);
		RegisterGlobalHotkey(hwnd);

		AIServiceManager::GetInstance().SetMainWindowPtr(this);
		DataStore::GetInstance().LoadModelService();
		if (DataStore::GetInstance().GetModelService() == "Ollama" || DataStore::GetInstance().GetModelService() == "") {
			AIServiceManager::GetInstance().LoadModels();
		}
		else if (DataStore::GetInstance().GetModelService() == "Google Gemini") {
			AIServiceManager::GetInstance().LoadModels();
			std::cout << "Google Gemini" << std::endl;
		}
	}

	void MainWindow::MoveAndResizeWindow(float widthPercentage, float heightPercentage) const
	{
		// Get the app window and display area
		auto& appWindow = AppWindow();
		auto& displayArea = DisplayArea::GetFromWindowId(appWindow.Id(), DisplayAreaFallback::Primary);
		auto& workArea = displayArea.WorkArea();

		const int32_t& windowWidth = static_cast<int32_t>(workArea.Width * widthPercentage);
		const int32_t& windowHeight = static_cast<int32_t>(workArea.Height * heightPercentage);

		const int32_t& centerX = workArea.X + (workArea.Width / 2); // Center the window on the screen Horizontally
		const int32_t& centerY = workArea.Y + (workArea.Height * 1 / 3); // Window with 33% Margin from top of the screen 

		appWindow.MoveAndResize(Windows::Graphics::RectInt32{ centerX - (windowWidth / 2), centerY - (windowHeight / 2), windowWidth, windowHeight });
	}

	void MainWindow::TextBoxElement_KeyDown(Windows::Foundation::IInspectable const& sender, KeyRoutedEventArgs const& e)
	{
		auto& textBox = sender.as<Microsoft::UI::Xaml::Controls::TextBox>();
		if (e.Key() == winrt::Windows::System::VirtualKey::Enter && !textBox.IsReadOnly())
		{
			std::string const& inputText = to_string(textBox.Text());
			std::string const& model = DataStore::GetInstance().GetSelectedModel();

			res = "";

			PluginManager::GetInstance().BroadcastEvent("beforeTextGeneration");

			std::thread([model, this, inputText]() {

				try {
					/*if (DataStore::GetInstance().) {
						ollama::generate(model, inputText, OllamaService::GetInstance().TextGeneration());
					}
					else if (SettingsWindow::LoadSetting("Selected Service") == L"Google Gemini") {
						GoogleGeminiService::GetInstance().TextGeneration(inputText);
						std::cout << "Google Gemini" << std::endl;
					}*/

					AIServiceManager::GetInstance().TextGeneration(DataStore::GetInstance().GetSelectedModel(), inputText);
				}
				catch (const winrt::hresult_error& ex) {
					// Handle exceptions from Response Generation
				}
				}).detach();

			TextBoxElement().IsReadOnly(true);
			StartSkeletonLoadingAnimation();

			/*auto wi = &winrt::Windows::UI::Core::CoreWindow::GetForCurrentThread();
			if (wi)
			{
				wi->GetKeyState(winrt::Windows::System::VirtualKey::Control);
				int caretIndex = textBox.SelectionStart();
				std::wstring text = textBox.Text().c_str();
				text.insert(caretIndex, L"\n");
				textBox.Text(winrt::hstring(text));
				textBox.SelectionStart(caretIndex + 1);
				e.Handled(true);
			}*/

		}
	}

	void MainWindow::UpdateTextBox(hstring const& text)
	{
		&res.append(to_string(text));
		TextBoxElement().Text(to_hstring(res));
	}

	void MainWindow::ShowTrayMenu()
	{
		Window settingsWindow = winrt::make<SettingsWindow>();
		settingsWindow.Activate();
	}

	void MainWindow::AddTrayIcon(HWND hWnd)
	{
		NOTIFYICONDATA nid = {};
		nid.cbSize = sizeof(NOTIFYICONDATA);
		nid.hWnd = hWnd;  // Handle to your window
		nid.uID = 1;  // Tray icon ID
		nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
		nid.uCallbackMessage = WM_TRAYICON; // Custom message to handle clicks


		HICON hIcon = (HICON)LoadImage(
			NULL,                     // hInstance is NULL when loading from a file
			L"Assets/LlamaRun.ico", // Path to your .ico file
			IMAGE_ICON,               // Type of image
			0, 0,                     // Default icon size (use 0,0 for default size)
			LR_LOADFROMFILE           // Load from file flag
		);


		nid.hIcon = hIcon;  // Load an icon for the tray
		wcscpy_s(nid.szTip, L"Llama Run");

		// Add the icon to the system tray
		Shell_NotifyIcon(NIM_ADD, &nid);
	}

	void MainWindow::TextBoxElement_TextChanged(Windows::Foundation::IInspectable const&, TextChangedEventArgs const&)
	{
		scrollViewer().ChangeView(nullptr, scrollViewer().ScrollableHeight(), nullptr, false);
		/*if (sender.as<Microsoft::UI::Xaml::Controls::TextBox>().Text() == L"")
		{
			MoveAndResizeWindow(0.3f, 0.08f);
		}*/
	}
}
