#include "pch.h"
#include "MainWindow.xaml.h"
#if __has_include("MainWindow.g.cpp")
#include "MainWindow.g.cpp"
#endif

#include <BackgroundOllama.hpp>
#include <future>
#include <atomic>

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

#include <iostream>
#include <DataStore.cpp>
#include <SettingsWindow.xaml.h>

namespace winrt::LlamaRun::implementation
{
	MainWindow::MainWindow()
	{
		Title(L"Llama Run");

		// Extend content into the title bar
		ExtendsContentIntoTitleBar(true);
		bool extended = AppWindow().TitleBar().ExtendsContentIntoTitleBar();

		auto appWindow = AppWindow();
		auto presenter = appWindow.Presenter().as<OverlappedPresenter>();

		presenter.IsMaximizable(false);
		presenter.IsMinimizable(false);
		presenter.IsResizable(false);
		presenter.SetBorderAndTitleBar(true, false);

		//presenter.IsAlwaysOnTop(true);
		//appWindow.IsShownInSwitchers(false);

		CheckandLoadOllama();

		this->Closed({ this, &MainWindow::OnWindowClosed });
	}

	void MainWindow::CheckandLoadOllama() {
		if (IsOllamaAvailable())
		{
			OutputDebugString(L"Ollama Avaliable");
			ShowOllamaDialog();
		}
		else
		{
			throw std::exception("Ollama not Avaliable!");
		}


		auto& weakThis = *this;
		std::thread serverCheckThread([&]() {
			if (weakThis && weakThis.DispatcherQueue()) { // Check for both 'this' and DispatcherQueue
				weakThis.DispatcherQueue().TryEnqueue(
					winrt::Microsoft::UI::Dispatching::DispatcherQueuePriority::Normal,
					[&weakThis]() {
						weakThis.TextBoxElement().PlaceholderText(L"Waiting for Ollama server!");
						weakThis.TextBoxElement().IsReadOnly(true);
					}
				);
			}
			while (!ollama::is_running()) {
				std::this_thread::sleep_for(std::chrono::seconds(2));
			}

			// Once server is up, load the models
			MainWindow::models = ListModel();

			if (models.size() <= 0) {
				throw std::exception("No Models Downloaded");
			}
			DataStore::GetInstance().SetModels(models);

			if (SettingsWindow::LoadSetting("SelectedModel") != L"")
			{
				auto selectedModel = SettingsWindow::LoadSetting("SelectedModel");
				DataStore::GetInstance().SetSelectedModel(to_string(selectedModel));
			}

			if (DataStore::GetInstance().GetSelectedModel() != "")
			{
				LoadModelIntoMemory(DataStore::GetInstance().GetSelectedModel());
			}
			else
			{
				DataStore::GetInstance().SetSelectedModel(models[0]);
				LoadModelIntoMemory(models[0]);

				SettingsWindow::SaveSetting("SelectedModel", DataStore::GetInstance().GetSelectedModel());
			}

			if (weakThis && weakThis.DispatcherQueue()) { // Check for both 'this' and DispatcherQueue
				weakThis.DispatcherQueue().TryEnqueue(
					winrt::Microsoft::UI::Dispatching::DispatcherQueuePriority::Normal,
					[&weakThis]() {
						weakThis.TextBoxElement().PlaceholderText(L"Ask Anything!");
						weakThis.TextBoxElement().IsReadOnly(false);
					}
				);
			}
			});

		serverCheckThread.detach();
	}

	bool MainWindow::IsOllamaAvailable()
	{
		// Try running the Ollama command using system()
		int result = system("ollama --version");

		// Check the result, if the command fails, Ollama is not installed
		return result == 0;
	}

	void MainWindow::ShowOllamaDialog()
	{
		auto newWindow = Window();

		newWindow.AppWindow().Resize({ 400, 200 });

		TextBlock messageText;
		messageText.Text(L"Ollama is not installed! Please install and download a Model");
		messageText.HorizontalAlignment(winrt::Microsoft::UI::Xaml::HorizontalAlignment::Center);
		messageText.VerticalAlignment(winrt::Microsoft::UI::Xaml::VerticalAlignment::Center);
		messageText.Margin({ 0, 20, 0, 0 });
		messageText.TextWrapping(TextWrapping::WrapWholeWords);

		Button closeButton;
		closeButton.Content(winrt::box_value(L"OK"));
		closeButton.HorizontalAlignment(winrt::Microsoft::UI::Xaml::HorizontalAlignment::Center);
		closeButton.Margin({ 0, 20, 0, 0 });
		closeButton.Click([newWindow](IInspectable const&, winrt::Microsoft::UI::Xaml::RoutedEventArgs const&)
			{
				newWindow.Close();
			});

		StackPanel panel;
		panel.Children().Append(messageText);
		panel.Children().Append(closeButton);

		newWindow.Content(panel);
		newWindow.Title(L"Error");

		newWindow.Activate();
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

	void winrt::LlamaRun::implementation::MainWindow::AppTitleBar_Loaded(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& e)
	{
		MoveAndResizeWindow(0.38f, 0.1f);// 38% of the work area width and 10% of the work area height

		hWnd = GetActiveWindow();
		AddTrayIcon(hWnd);
		SubclassWndProc(hWnd);
		RegisterGlobalHotkey(hWnd);
	}

	void MainWindow::MoveAndResizeWindow(float widthPercentage, float heightPercentage)
	{
		// Get the app window and display area
		auto appWindow = AppWindow();
		auto displayArea = DisplayArea::GetFromWindowId(appWindow.Id(), DisplayAreaFallback::Primary);
		auto workArea = displayArea.WorkArea();

		int32_t windowWidth = static_cast<int32_t>(workArea.Width * widthPercentage);
		int32_t windowHeight = static_cast<int32_t>(workArea.Height * heightPercentage);

		int32_t centerX = workArea.X + (workArea.Width / 2); // Center the window on the screen Horizontally
		int32_t centerY = workArea.Y + (workArea.Height * 1 / 3); // Window with 33% Margin from top of the screen 

		appWindow.MoveAndResize(Windows::Graphics::RectInt32{ centerX - (windowWidth / 2), centerY - (windowHeight / 2), windowWidth, windowHeight });
	}

	void winrt::LlamaRun::implementation::MainWindow::TextBoxElement_KeyDown(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::Input::KeyRoutedEventArgs const& e)
	{
		auto textBox = sender.as<Microsoft::UI::Xaml::Controls::TextBox>();
		if (e.Key() == winrt::Windows::System::VirtualKey::Enter && !textBox.IsReadOnly())
		{
			std::string inputText = to_string(textBox.Text());
			std::string model = DataStore::GetInstance().GetSelectedModel();
			auto& weakThis = *this;

			res = "";

			std::thread([model, &weakThis, inputText]() {
				using ResponseCallback = winrt::delegate<void(ollama::response const&)>;
				ResponseCallback callback = [&weakThis](ollama::response const& response) {
					if (weakThis && weakThis.DispatcherQueue()) { // Check for both 'this' and DispatcherQueue
						weakThis.DispatcherQueue().TryEnqueue(
							winrt::Microsoft::UI::Dispatching::DispatcherQueuePriority::Normal,
							[&weakThis, response]() {
								if (response.as_json()["done"] == true) {
									weakThis.StopSkeletonLoadingAnimation();
									weakThis.TextBoxElement().IsReadOnly(false);
								}
								weakThis.UpdateTextBox(to_hstring(response.as_simple_string()));
							}
						);
					}
					else {
						// Handle case where 'this' or DispatcherQueue is null
						// (e.g., log a message, display an error)
					}
					};

				try {
					ollama::generate(model, inputText, callback); // Try-catch block to handle exceptions
				}
				catch (const winrt::hresult_error& ex) {
					// Handle exceptions from ollama::generate
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
		res.append(to_string(text));
		TextBoxElement().Text(to_hstring(res));
	}

	void MainWindow::ShowTrayMenu()
	{
		winrt::LlamaRun::SettingsWindow settingsWindow;
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

	void MainWindow::OnWindowClosed(IInspectable const&, IInspectable const& args)
	{
		//hWnd = GetActiveWindow();


		//if (IsWindowVisible(hWnd))
		//{
		//	ShowWindowAsync(hWnd, SW_HIDE);
		//	AddTrayIcon(hWnd);

		//	SubclassWndProc(hWnd);

		//	// Register the hotkey
		//	RegisterGlobalHotkey(hWnd);
		//}
		///*Cancel the close operation*/
		args.as<WindowEventArgs>().Handled(true);
	}

	void winrt::LlamaRun::implementation::MainWindow::TextBoxElement_TextChanged(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::Controls::TextChangedEventArgs const& e)
	{
		scrollViewer().ChangeView(nullptr, scrollViewer().ScrollableHeight(), nullptr);
		/*if (sender.as<Microsoft::UI::Xaml::Controls::TextBox>().Text() == L"")
		{
			MoveAndResizeWindow(0.3f, 0.08f);
		}*/
	}
}
