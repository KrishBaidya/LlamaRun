#include "pch.h"
#include "SettingsWindow.xaml.h"
#if __has_include("SettingsWindow.g.cpp")
#include "SettingsWindow.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace winrt::Microsoft::UI::Xaml::Media;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
	void SettingsWindow::MyComboBox_Loaded(IInspectable const&, IInspectable const& args)
	{
		/*auto& models = ListModel();
		for (auto model : models)
		{
			auto newItem = winrt::Microsoft::UI::Xaml::Controls::ComboBoxItem();
			newItem.Content(winrt::box_value(to_hstring(model)));
			MyComboBox().Items().Append(newItem);
		}*/
	}

	int32_t SettingsWindow::MyProperty()
	{
		throw hresult_not_implemented();
	}

	void SettingsWindow::MyProperty(int32_t /* value */)
	{
		throw hresult_not_implemented();
	}
}
