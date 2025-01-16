#pragma once

#include "PluginPage_SettingsWindow.g.h"

namespace winrt::LlamaRun::implementation
{
	struct PluginPage_SettingsWindow : PluginPage_SettingsWindowT<PluginPage_SettingsWindow>
	{
		PluginPage_SettingsWindow()
		{
			// Xaml objects should not call InitializeComponent during construction.
			// See https://github.com/microsoft/cppwinrt/tree/master/nuget#initializecomponent
		}

		void PluginNavigationView_SelectionChanged(winrt::Microsoft::UI::Xaml::Controls::NavigationView const&, winrt::Microsoft::UI::Xaml::Controls::NavigationViewSelectionChangedEventArgs const& args);
		void PluginNavigationView_Loaded(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);

		int32_t MyProperty();
		void MyProperty(int32_t value);
	};
}

namespace winrt::LlamaRun::factory_implementation
{
	struct PluginPage_SettingsWindow : PluginPage_SettingsWindowT<PluginPage_SettingsWindow, implementation::PluginPage_SettingsWindow>
	{
	};
}
