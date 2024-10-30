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
		void SaveButtonClicked(IInspectable const&, IInspectable const& args);

		fire_and_forget RequestStartupChange(const bool&);

		void MyComboBox_Loaded(IInspectable const&, IInspectable const& args);

		int32_t MyProperty();
		void MyProperty(int32_t value);

		static void SaveSetting(const std::string&, const std::string&);
		static void SaveSetting(const std::string&, const hstring&);

		static winrt::hstring LoadSetting(const std::string& key);
		void rootPanel_Loaded(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);
	};
}

namespace winrt::LlamaRun::factory_implementation
{
	struct SettingsWindow : SettingsWindowT<SettingsWindow, implementation::SettingsWindow>
	{
	};
}
