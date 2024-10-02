#pragma once
#include "MainWindow.g.h"

namespace winrt::App2::implementation
{
	struct MainWindow : MainWindowT<MainWindow>
	{
		MainWindow();

		std::vector<std::string> MainWindow::models = std::vector<std::string>();

		HWND hWnd = nullptr;

		std::string res = "";

		void UpdateTextBox(hstring const& text);

		// Add the tray icon
		void AddTrayIcon(HWND hWnd);

		int32_t MyProperty();
		void MyProperty(int32_t value);

		void StartSkeletonLoadingAnimation();

		void MoveAndResizeWindow(float, float);

		void myButton_Click(IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& args);
		void AppTitleBar_Loaded(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& e);
		void TextBoxElement_KeyDown(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::Input::KeyRoutedEventArgs const& e);

		void OnWindowClosed(IInspectable const&, IInspectable const&);

		static LRESULT CALLBACK CustomWndProc(HWND hWnd, UINT uMsg, WPARAM wParam, LPARAM lParam)
		{
			switch (uMsg)
			{
			case WM_HOTKEY:
				if (!IsWindowVisible(hWnd))
				{
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
				SetForegroundWindow(hWnd);
				return 0;
			default:
				return DefWindowProc(hWnd, uMsg, wParam, lParam);
			}
		}

		void SubclassWndProc(HWND hwnd)
		{
			SetWindowLongPtr(hwnd, GWLP_WNDPROC, (LONG_PTR)CustomWndProc);
		}

		void RegisterGlobalHotkey(HWND hwnd)
		{
			if (!RegisterHotKey(hwnd, 1, MOD_CONTROL | MOD_SHIFT, 0x41))  // Ctrl + Shift + A
			{
				MessageBox(nullptr, L"Failed to register hotkey", L"Error", MB_OK | MB_ICONERROR);
			}
			else
			{
				//MessageBox(nullptr, L"Hotkey registered!", L"Success", MB_OK);
			}
		}

		void UnregisterGlobalHotkey(HWND hwnd)
		{
			UnregisterHotKey(hwnd, 1);
		}
		void TextBoxElement_TextChanged(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::Controls::TextChangedEventArgs const& e);
	};
}

namespace winrt::App2::factory_implementation
{
	struct MainWindow : MainWindowT<MainWindow, implementation::MainWindow>
	{
	};
}
