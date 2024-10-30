#include "pch.h"
#include "FirstRunWindow.xaml.h"
#include "MainWindow.xaml.h"
#if __has_include("FirstRunWindow.g.cpp")
#include "FirstRunWindow.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::LlamaRun::implementation
{
	int32_t FirstRunWindow::MyProperty()
	{
		throw hresult_not_implemented();
	}

	void FirstRunWindow::MyProperty(int32_t /* value */)
	{
		throw hresult_not_implemented();
	}

	void FirstRunWindow::UpdateStep()
	{
		// Update the step title and description based on current step
		switch (currentStep)
		{
		case 0:
			StepTitle().Text(L"Step 1: AI Answers");
			StepDescription().Text(L"Instantly get answers to programming questions and tech problems.");
			break;
		case 1:
			StepTitle().Text(L"Step 2: Hotkey Activation");
			StepDescription().Text(L"Wake LlamaRun with a hotkey, ready to assist anytime. Just Press Ctrl + Shift + A");
			break;
		case 2:
			StepTitle().Text(L"Step 3: Lightweight & Always On");
			StepDescription().Text(L"LlamaRun starts with your PC, so you always have AI assistance at your fingertips.");
			break;
		}

		// Update progress bar
		ProgressIndicator().Value(currentStep * 100.0 / 2.0);

		// Enable/disable buttons
		PreviousButton().IsEnabled(currentStep > 0);
		NextButton().IsEnabled(currentStep < 2);
	}

	void FirstRunWindow::Previous_Click(IInspectable const&, IInspectable const&)
	{
		if (currentStep > 0)
		{
			currentStep--;
			UpdateStep();
		}
	}

	void FirstRunWindow::Next_Click(IInspectable const&, IInspectable const&)
	{
		if (currentStep < 2)
		{
			currentStep++;
			UpdateStep();
		}
	}

	void FirstRunWindow::Finish_Click(IInspectable const&, IInspectable const&)
	{
		auto window = winrt::make<MainWindow>();
		window.Activate();

		this->Close();
	}

	fire_and_forget FirstRunWindow::RequestStartup()
	{
		auto& startupTask = co_await winrt::Windows::ApplicationModel::StartupTask::GetAsync(L"LLamaRun Generation");

		switch (startupTask.State())
		{
		case winrt::Windows::ApplicationModel::StartupTaskState::Disabled:
			co_await startupTask.RequestEnableAsync();
			break;

		case winrt::Windows::ApplicationModel::StartupTaskState::DisabledByUser:
			co_await startupTask.RequestEnableAsync();
			break;

		case winrt::Windows::ApplicationModel::StartupTaskState::DisabledByPolicy:
			// Startup disabled by group policy
			break;

		case winrt::Windows::ApplicationModel::StartupTaskState::Enabled:
			// Already enabled
			break;
		}
	}

	void FirstRunWindow::Grid_Loaded(IInspectable const& sender, RoutedEventArgs const& e)
	{
		UpdateStep();
	}
}