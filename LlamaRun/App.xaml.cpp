#pragma once

#include "pch.h"
#include "App.xaml.h"
#include "MainWindow.xaml.h"
#include "SettingsWindow.xaml.h"
#include <FirstRunWindow.xaml.h>

#include <Python/Python.h>
#include <PluginDef.h>
#include <PluginManager.h>

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
		{
			// Step 1: Initialize the Python interpreter
			PyImport_AppendInittab("myapp", PyInit_myapp);
			PluginManager::GetInstance();
			PyImport_ImportModule("myapp");

#ifdef _DEBUG
			// Step 2: Allocate a console for output
			AllocConsole();

			// Step 3: Redirect C++ output to the console
			freopen("CONOUT$", "w", stdout);
			freopen("CONOUT$", "w", stderr);

			// Step 4: Redirect Python's output to the console
			PyRun_SimpleString(
				"import sys\n"
				"sys.stdout = open('CONOUT$', 'w')\n"
				"sys.stderr = open('CONOUT$', 'w')\n"
			);

			// Print a test message from C++
			std::cout << "Hello from C++!" << std::endl;

			// Step 5: Execute some Python code that prints to the console
			PyRun_SimpleString("import myapp; print('Hello from Python!'); print(myapp.get_productivity_data())");

#endif // DEBUG

			PluginManager::GetInstance().LoadAllPlugins();
		}

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

			//SettingsWindow::SaveSetting("isFirstRun", to_hstring<bool>(true));
		}

	}
}
