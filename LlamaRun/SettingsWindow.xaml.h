#pragma once

#include "SettingsWindow.g.h"

namespace winrt::LlamaRun::implementation
{
	struct SettingsWindow : SettingsWindowT<SettingsWindow>
	{
		SettingsWindow()
		{
			// Xaml objects should not call InitializeComponent during construction.
			// See https://github.com/microsoft/cppwinrt/tree/master/nuget#initializecomponent

			Title(L"Llama Run Settings");
			ExtendsContentIntoTitleBar(true);
		}

		int32_t MyProperty();
		void MyProperty(int32_t value);

		static void SaveSetting(const std::string&, const std::string&);
		static void SaveSetting(const std::string&, const hstring&);

		static Windows::Foundation::IAsyncAction CopyFolderAsync(const Windows::Storage::StorageFolder&, const Windows::Storage::StorageFolder&);

		static winrt::hstring LoadSetting(const std::string& key);
		void NavigationView_SelectionChanged(winrt::Microsoft::UI::Xaml::Controls::NavigationView const&, winrt::Microsoft::UI::Xaml::Controls::NavigationViewSelectionChangedEventArgs const&);
		void NavigationView_Loaded(winrt::Windows::Foundation::IInspectable const&, winrt::Microsoft::UI::Xaml::RoutedEventArgs const&);
	};
}

namespace winrt::LlamaRun::factory_implementation
{
	struct SettingsWindow : SettingsWindowT<SettingsWindow, implementation::SettingsWindow>
	{
	};
}
