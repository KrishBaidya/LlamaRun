#include "pch.h"
#include "SettingsWindow.xaml.h"
#if __has_include("SettingsWindow.g.cpp")
#include "SettingsWindow.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
    int32_t SettingsWindow::MyProperty()
    {
        throw hresult_not_implemented();
    }

    void SettingsWindow::MyProperty(int32_t /* value */)
    {
        throw hresult_not_implemented();
    }

    void SettingsWindow::myButton_Click(IInspectable const&, RoutedEventArgs const&)
    {

    }
}
