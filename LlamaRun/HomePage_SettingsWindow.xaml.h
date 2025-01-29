#pragma once

#include "HomePage_SettingsWindow.g.h"

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace winrt::Microsoft::UI::Xaml::Media;
using namespace Windows::Foundation;
using namespace Windows::Storage;

namespace winrt::LlamaRun::implementation
{
    struct HomePage_SettingsWindow : HomePage_SettingsWindowT<HomePage_SettingsWindow>
    {
        HomePage_SettingsWindow()
        {
            // Xaml objects should not call InitializeComponent during construction.
            // See https://github.com/microsoft/cppwinrt/tree/master/nuget#initializecomponent
        }

        int32_t MyProperty();
        void MyProperty(int32_t value);

        void rootPanel_Loaded(IInspectable const&, RoutedEventArgs const&);

        void Model_ComboBox_Loaded(IInspectable const&, IInspectable const&);

        fire_and_forget RequestStartupChange(bool Enable);

        void Update_Model_ComboBox();

        void SaveButtonClicked(IInspectable const&, IInspectable const&);
        fire_and_forget ModelService_ComboBox_SelectionChanged(winrt::Windows::Foundation::IInspectable const&, winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const&);
        fire_and_forget ApiKey_TextChanged(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::Controls::TextChangedEventArgs const& e);
    };
}

namespace winrt::LlamaRun::factory_implementation
{
    struct HomePage_SettingsWindow : HomePage_SettingsWindowT<HomePage_SettingsWindow, implementation::HomePage_SettingsWindow>
    {
    };
}
