#include "pch.h"
#include "OllamaNotAvaliablePage.xaml.h"
#if __has_include("OllamaNotAvaliablePage.g.cpp")
#include "OllamaNotAvaliablePage.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
    int32_t OllamaNotAvaliablePage::MyProperty()
    {
        throw hresult_not_implemented();
    }

    void OllamaNotAvaliablePage::MyProperty(int32_t /* value */)
    {
        throw hresult_not_implemented();
    }

    void OllamaNotAvaliablePage::OnOKClick(IInspectable const&, RoutedEventArgs const&)
    {

    }
}
