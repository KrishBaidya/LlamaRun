#pragma once
#include "MainWindow.g.h"

constexpr auto ID_TRAYICON_RESTORE = 1001;
constexpr auto ID_TRAYICON_EXIT = 1002;
constexpr auto WM_TRAYICON = (WM_USER + 1);

namespace winrt::LlamaRun::implementation
{
	struct MainWindow : MainWindowT<MainWindow>
	{
		MainWindow();

		void SubclassWndProc(HWND const& hwnd);

		std::string res = "";

		void UpdateTextBox(hstring const& text);

		void ShowTrayMenu();

		void AddTrayIcon(HWND hWnd);

		int32_t MyProperty();
		void MyProperty(int32_t value);

		void StartSkeletonLoadingAnimation();
		void StopSkeletonLoadingAnimation();

		void MoveAndResizeWindow(float widthPercentage, float heightPercentage) const;

		void AppTitleBar_Loaded(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& e);
		void TextBoxElement_KeyDown(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::Input::KeyRoutedEventArgs const& e);

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

		void SetFocusOnTextBox()
		{
			winrt::Microsoft::UI::Xaml::FocusState key = winrt::Microsoft::UI::Xaml::FocusState::Keyboard;
			TextBoxElement().Focus(key);
		}
	};
}

namespace winrt::LlamaRun::factory_implementation
{
	struct MainWindow : MainWindowT<MainWindow, implementation::MainWindow>
	{
	};
}
