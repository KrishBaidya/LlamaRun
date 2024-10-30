#include "pch.h"
#include "ShowOllamaUnavaliableWindow.h"

using namespace winrt;
using namespace Microsoft::UI;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Input;
using namespace Microsoft::UI::Windowing;
using namespace Windows::UI::ViewManagement;
using namespace Windows::ApplicationModel::AppService;
using namespace winrt::Windows::Foundation::Collections;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Xaml::Media;
using namespace Microsoft::UI::Xaml::Media::Animation;
using namespace winrt::Windows::Foundation;

ShowOllamaUnavaliableWindow& ShowOllamaUnavaliableWindow::GetInstance()
{
	static ShowOllamaUnavaliableWindow instance;
	return instance;
}

void ShowOllamaUnavaliableWindow::showOllamaDialog()
{
	auto newWindow = Window();
	newWindow.AppWindow().Resize({ 500, 300 });

	// Create a Grid container
	Grid grid;

	// Define rows for the Grid
	RowDefinition rowDef1;
	rowDef1.Height(GridLength{ 1, GridUnitType::Star }); // Auto-size row for messageText
	grid.RowDefinitions().Append(rowDef1);

	RowDefinition rowDef2;
	rowDef2.Height(GridLength{ 1, GridUnitType::Auto }); // Auto-size row for ollamaLink
	grid.RowDefinitions().Append(rowDef2);

	RowDefinition rowDef3;
	rowDef3.Height(GridLength{ 1, GridUnitType::Star }); // Take remaining space for layout flexibility
	grid.RowDefinitions().Append(rowDef3);

	RowDefinition rowDef4;
	rowDef4.Height(GridLength{ 1, GridUnitType::Auto }); // Auto-size row for closeButton
	grid.RowDefinitions().Append(rowDef4);

	// Create the messageText block
	TextBlock messageText;
	messageText.Text(L"Ollama is not installed! Please install and download a Model");
	messageText.HorizontalAlignment(HorizontalAlignment::Center);
	messageText.Margin({ 0, 30, 0, 0 });
	messageText.TextWrapping(TextWrapping::WrapWholeWords);

	// Create the HyperlinkButton
	HyperlinkButton ollamaLink;
	ollamaLink.NavigateUri(Uri(L"https://ollama.com"));
	ollamaLink.Content(winrt::box_value(L"Get Ollama"));
	ollamaLink.HorizontalAlignment(HorizontalAlignment::Center);

	// Create the closeButton
	Button closeButton;
	closeButton.Content(winrt::box_value(L"OK"));
	closeButton.HorizontalAlignment(HorizontalAlignment::Center);
	closeButton.Margin({ 0, -100, 0, 0 });
	closeButton.Click([newWindow](IInspectable const&, winrt::Microsoft::UI::Xaml::RoutedEventArgs const&)
		{
			newWindow.Close();
			Application::Current().Exit();
		});

	// Add the messageText to the Grid at row 0
	grid.Children().Append(messageText);
	Grid::SetRow(messageText, 0);

	// Add the ollamaLink to the Grid at row 1
	grid.Children().Append(ollamaLink);
	Grid::SetRow(ollamaLink, 1);

	// The empty space (row 2) will automatically stretch due to the star sizing

	// Add the closeButton to the Grid at row 3 (bottom row)
	grid.Children().Append(closeButton);
	Grid::SetRow(closeButton, 3);

	// Add a background to the Grid
	ResourceDictionary resources = Application::Current().Resources();
	auto brush = resources.Lookup(box_value(L"AcrylicBackgroundFillColorBaseBrush")).as<Brush>();
	grid.Background(brush);

	// Set the Grid as the content of the window
	newWindow.Content(grid);
	newWindow.Title(L"Error");
	newWindow.Closed([newWindow](IInspectable const&, IInspectable const&)
		{
			newWindow.Close();
			Application::Current().Exit();
		});

	// Extend content into the title bar and configure the window's presenter
	newWindow.ExtendsContentIntoTitleBar(true);

	auto appWindow = newWindow.AppWindow();
	auto presenter = appWindow.Presenter().as<OverlappedPresenter>();

	presenter.IsMaximizable(false);
	presenter.IsMinimizable(false);
	presenter.IsAlwaysOnTop(true);

	// Activate the new window
	newWindow.Activate();
}
