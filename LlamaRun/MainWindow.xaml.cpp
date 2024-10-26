#include "pch.h"
#include "MainWindow.xaml.h"
#if __has_include("MainWindow.g.cpp")
#include "MainWindow.g.cpp"
#endif

#include <BackgroundOllama.hpp>
#include <future>
#include <atomic>
#include <winrt/Microsoft.UI.Composition.SystemBackdrops.h>

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
#include "VSCodeConnector.h"

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

		presenter.IsAlwaysOnTop(true);
		appWindow.IsShownInSwitchers(false);
	}

	void MainWindow::CheckandLoadOllama() {
		if (IsOllamaAvailable())
		{
			OutputDebugString(L"Ollama Avaliable");
		}
		else
		{
			ShowOllamaDialog();
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
		newWindow.AppWindow().Resize({ 500, 300 });

		// Create a Grid container
		Grid grid;

		// Define rows for the Grid
		RowDefinition rowDef1;
		rowDef1.Height(GridLength{ 1, GridUnitType::Star }); // Auto-size row for messageText
		grid.RowDefinitions().Append(rowDef1);

		RowDefinition rowDef2;
		rowDef2.Height(GridLength{ 1, GridUnitType::Auto }); // Auto-size row for ollamaLink
		grid.RowDefinitions().Append(rowDef2);

		RowDefinition rowDef3;
		rowDef3.Height(GridLength{ 1, GridUnitType::Star }); // Take remaining space for layout flexibility
		grid.RowDefinitions().Append(rowDef3);

		RowDefinition rowDef4;
		rowDef4.Height(GridLength{ 1, GridUnitType::Auto }); // Auto-size row for closeButton
		grid.RowDefinitions().Append(rowDef4);

		// Create the messageText block
		TextBlock messageText;
		messageText.Text(L"Ollama is not installed! Please install and download a Model");
		messageText.HorizontalAlignment(HorizontalAlignment::Center);
		messageText.Margin({ 0, 30, 0, 0 });
		messageText.TextWrapping(TextWrapping::WrapWholeWords);

		// Create the HyperlinkButton
		HyperlinkButton ollamaLink;
		ollamaLink.NavigateUri(Uri(L"https://ollama.com"));
		ollamaLink.Content(winrt::box_value(L"Get Ollama"));
		ollamaLink.HorizontalAlignment(HorizontalAlignment::Center);

		// Create the closeButton
		Button closeButton;
		closeButton.Content(winrt::box_value(L"OK"));
		closeButton.HorizontalAlignment(HorizontalAlignment::Center);
		closeButton.Margin({ 0, -100, 0, 0 });
		closeButton.Click([newWindow](IInspectable const&, winrt::Microsoft::UI::Xaml::RoutedEventArgs const&)
			{
				newWindow.Close();
				Application::Current().Exit();
			});

		// Add the messageText to the Grid at row 0
		grid.Children().Append(messageText);
		Grid::SetRow(messageText, 0);

		// Add the ollamaLink to the Grid at row 1
		grid.Children().Append(ollamaLink);
		Grid::SetRow(ollamaLink, 1);

		// The empty space (row 2) will automatically stretch due to the star sizing

		// Add the closeButton to the Grid at row 3 (bottom row)
		grid.Children().Append(closeButton);
		Grid::SetRow(closeButton, 3);

		// Add a background to the Grid
		ResourceDictionary resources = Application::Current().Resources();
		auto brush = resources.Lookup(box_value(L"AcrylicBackgroundFillColorBaseBrush")).as<Brush>();
		grid.Background(brush);

		// Set the Grid as the content of the window
		newWindow.Content(grid);
		newWindow.Title(L"Error");
		newWindow.Closed([newWindow](IInspectable const&, IInspectable const&)
			{
				newWindow.Close();
				Application::Current().Exit();
			});

		// Extend content into the title bar and configure the window's presenter
		newWindow.ExtendsContentIntoTitleBar(true);

		auto appWindow = newWindow.AppWindow();
		auto presenter = appWindow.Presenter().as<OverlappedPresenter>();

		presenter.IsMaximizable(false);
		presenter.IsMinimizable(false);
		presenter.IsAlwaysOnTop(true);

		// Activate the new window
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

		CheckandLoadOllama();
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
				bool isVSCodeActive = VSCodeConnector::GetInstance().IsVSCodeActive();

				using ResponseCallback = winrt::delegate<void(ollama::response const&)>;
				ResponseCallback callback_textbox = [&weakThis](ollama::response const& response) {
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
					if (isVSCodeActive)
					{
						SOCKET ConnectSocket = INVALID_SOCKET;

						if (!VSCodeConnector::GetInstance().setupSocket(ConnectSocket)) {
							OutputDebugString(L"Failed to set up socket connection to VS Code.");
							throw std::runtime_error("Failed to set up socket connection to VS Code.");
						}

						ResponseCallback callback_vscode = [&weakThis, isVSCodeActive, ConnectSocket](ollama::response const& response) {
							if (weakThis && weakThis.DispatcherQueue()) { // Check for both 'this' and DispatcherQueue
								weakThis.DispatcherQueue().TryEnqueue(
									winrt::Microsoft::UI::Dispatching::DispatcherQueuePriority::Normal,
									[&weakThis, response, ConnectSocket]() {
										if (response.as_json()["done"] == true) {
											weakThis.StopSkeletonLoadingAnimation();
											weakThis.TextBoxElement().IsReadOnly(false);
										}
										// Send the current chunk to VS Code
										if (!VSCodeConnector::GetInstance().streamCodeToVSCode(response, ConnectSocket)) {
											OutputDebugString(L"Failed to send code chunk to VS Code.");
										}
									}
								);
							}
							else {
								// Handle case where 'this' or DispatcherQueue is null
								// (e.g., log a message, display an error)
							}
							};

						ollama::generate(model, inputText, callback_vscode);

						VSCodeConnector::GetInstance().cleanupSocket(ConnectSocket);

						return 0;
					}
					ollama::generate(model, inputText, callback_textbox);
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

	void winrt::LlamaRun::implementation::MainWindow::TextBoxElement_TextChanged(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::Controls::TextChangedEventArgs const& e)
	{
		scrollViewer().ChangeView(nullptr, scrollViewer().ScrollableHeight(), nullptr);
		/*if (sender.as<Microsoft::UI::Xaml::Controls::TextBox>().Text() == L"")
		{
			MoveAndResizeWindow(0.3f, 0.08f);
		}*/
	}
}
