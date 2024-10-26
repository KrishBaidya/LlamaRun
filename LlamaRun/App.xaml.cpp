#include "pch.h"
#include "App.xaml.h"
#include "MainWindow.xaml.h"
#include "SettingsWindow.xaml.h"
#include <FirstRunWindow.xaml.h>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Windowing;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
	/// <summary>
	/// Initializes the singleton application object.  This is the first line of authored code
	/// executed, and as such is the logical equivalent of main() or WinMain().
	/// </summary>
	App::App()
	{
		// Xaml objects should not call InitializeComponent during construction.
		// See https://github.com/microsoft/cppwinrt/tree/master/nuget#initializecomponent

#if defined _DEBUG && !defined DISABLE_XAML_GENERATED_BREAK_ON_UNHANDLED_EXCEPTION
		UnhandledException([](IInspectable const&, UnhandledExceptionEventArgs const& e)
			{
				if (IsDebuggerPresent())
				{
					auto errorMessage = e.Message();
					__debugbreak();
				}
			});
#endif
	}

	/// <summary>
	/// Invoked when the application is launched.
	/// </summary>
	/// <param name="e">Details about the launch request and process.</param>
	void App::OnLaunched([[maybe_unused]] LaunchActivatedEventArgs const& e)
	{
		auto a = SettingsWindow::LoadSetting("isFirstRun");
		bool isFirstRun;
		auto ab = std::istringstream(to_string(a));
		ab >> std::boolalpha >> isFirstRun;
		if (isFirstRun)
		{
			window = make<FirstRunWindow>();
			window.Activate();

			SettingsWindow::SaveSetting("isFirstRun", to_hstring<bool>(false));
		}
		else {
			window = make<MainWindow>();
			window.Activate();

			SettingsWindow::SaveSetting("isFirstRun", to_hstring<bool>(true));
		}

	}
}
