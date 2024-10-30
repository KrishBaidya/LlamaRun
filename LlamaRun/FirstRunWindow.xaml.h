#pragma once

#include "FirstRunWindow.g.h"

namespace winrt::LlamaRun::implementation
{
    struct FirstRunWindow : FirstRunWindowT<FirstRunWindow>
    {
        FirstRunWindow()
        {
            // Xaml objects should not call InitializeComponent during construction.
            // See https://github.com/microsoft/cppwinrt/tree/master/nuget#initializecomponent
            Title(L"Get Started - Llama Run");

            ExtendsContentIntoTitleBar(true);

            RequestStartup();
        }

        int currentStep = 0;
        void UpdateStep();

        void Previous_Click(IInspectable const&, IInspectable const&);

        void Next_Click(IInspectable const&, IInspectable const&);

        void Finish_Click(IInspectable const&, IInspectable const&);

        fire_and_forget RequestStartup();

        int32_t MyProperty();
        void MyProperty(int32_t value);
        void Grid_Loaded(winrt::Windows::Foundation::IInspectable const& sender, winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);
    };
}

namespace winrt::LlamaRun::factory_implementation
{
    struct FirstRunWindow : FirstRunWindowT<FirstRunWindow, implementation::FirstRunWindow>
    {
    };
}
