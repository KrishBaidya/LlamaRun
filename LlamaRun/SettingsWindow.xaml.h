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
			RequestStartup();
		}

		fire_and_forget SettingsWindow::RequestStartup();

		void MyComboBox_Loaded(IInspectable const&, IInspectable const& args);

		int32_t MyProperty();
		void MyProperty(int32_t value);
	};
}

namespace winrt::LlamaRun::factory_implementation
{
	struct SettingsWindow : SettingsWindowT<SettingsWindow, implementation::SettingsWindow>
	{
	};
}
