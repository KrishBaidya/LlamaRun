#pragma once

#include "InstalledPluginsPage.g.h"

#include <PluginManager.h>

namespace winrt::LlamaRun::implementation
{
	struct InstalledPluginsPage : InstalledPluginsPageT<InstalledPluginsPage>
	{
		InstalledPluginsPage()
		{
			// Xaml objects should not call InitializeComponent during construction.
			// See https://github.com/microsoft/cppwinrt/tree/master/nuget#initializecomponent
		}

		int32_t MyProperty();
		void MyProperty(int32_t value);
		void InstalledPluginsList_Loaded(winrt::Windows::Foundation::IInspectable const&, winrt::Microsoft::UI::Xaml::RoutedEventArgs const&);
		fire_and_forget InstalledPluginsPage::Delete_Click(IInspectable const&, RoutedEventArgs const&);
		IAsyncAction Install_From_Disk_Button_Click(IInspectable const&, winrt::Microsoft::UI::Xaml::RoutedEventArgs const&);
	};
}

namespace winrt::LlamaRun::factory_implementation
{
	struct InstalledPluginsPage : InstalledPluginsPageT<InstalledPluginsPage, implementation::InstalledPluginsPage>
	{
	};
}
