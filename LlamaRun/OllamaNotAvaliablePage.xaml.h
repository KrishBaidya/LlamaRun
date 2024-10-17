#pragma once
#include "pch.h"
#include "OllamaNotAvaliablePage.g.h"

using namespace winrt;
using namespace Microsoft::UI;
using namespace Microsoft::UI::Xaml;

namespace winrt::LlamaRun::implementation
{
	struct OllamaNotAvaliablePage : OllamaNotAvaliablePageT<OllamaNotAvaliablePage>
	{
		OllamaNotAvaliablePage()
		{
			// Xaml objects should not call InitializeComponent during construction.
			// See https://github.com/microsoft/cppwinrt/tree/master/nuget#initializecomponent
		}


		int32_t MyProperty();
		void MyProperty(int32_t value);

		void OnOKClick(IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& args);
	};
}

namespace winrt::LlamaRun::factory_implementation
{
	struct OllamaNotAvaliablePage : OllamaNotAvaliablePageT<OllamaNotAvaliablePage, implementation::OllamaNotAvaliablePage>
	{
	};
}
