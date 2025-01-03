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

        int32_t MyProperty();
        void MyProperty(int32_t value);

        void myButton_Click(IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& args);
    };
}

namespace winrt::LlamaRun::factory_implementation
{
    struct PluginPage_SettingsWindow : PluginPage_SettingsWindowT<PluginPage_SettingsWindow, implementation::PluginPage_SettingsWindow>
    {
    };
}
