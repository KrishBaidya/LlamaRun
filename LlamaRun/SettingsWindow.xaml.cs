using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Newtonsoft.Json;
using System;
using System.Diagnostics;
using System.Threading.Tasks;
using Windows.Storage;
using Windows.System;
using WinRT;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace LlamaRun
{
    /// <summary>
    /// An empty window that can be used on its own or navigated to within a Frame.
    /// </summary>
    public sealed partial class SettingsWindow : Window
    {
#if DEBUG
        private const string BackendUrl = "http://localhost:3000"; // Your Next.js Backend URL
#else
        private const string BackendUrl = "https://llamarun.vercel.app"; // Your Next.js Backend URL
#endif
        private const string REDIRECT_URI = "llama-run://auth";
        private readonly ApplicationDataContainer localSettings = ApplicationData.Current.LocalSettings;
        private static readonly Windows.Web.Http.HttpClient httpClient = new();

        public static bool IsAuth = false;

        public SettingsWindow()
        {
            this.InitializeComponent();

            Title = "Llama Run Settings";
            ExtendsContentIntoTitleBar = true;

            // Subscribe to the AuthenticationChanged event
            ((App)Application.Current).AuthenticationChanged += App_AuthenticationChanged;
            CheckAuthenticationStatus();
        }

        private async void App_AuthenticationChanged(object? sender, AuthenticationChangedEventArgs e)
        {
            Debug.WriteLine("App_AuthenticationChanged called!"); // Add this

            if (e.IsAuthenticated)
            {
                // Optionally fetch user info *after* authentication succeeds
                // Good place to do it, as we know the JWT is now valid.
                await FetchAndSaveUserInfo(DataStore.GetInstance().GetJWT()!);  // Use the non-null assertion operator (!)
                IsAuth = true; // Set IsAuth property to true when authenticated
            }
            else
            {
                IsAuth = false; // Set IsAuth property to false when not authenticated
            }

            UpdateUIForAuthStatus(e.IsAuthenticated);
        }

        public static async Task<string> GetProtectedDataAsync(string endpoint)
        {
            var _jwt = DataStore.GetInstance().LoadJWT().GetJWT();
            if (string.IsNullOrEmpty(_jwt))
            {
                throw new InvalidOperationException("Not authenticated.");
            }
            httpClient.DefaultRequestHeaders.Authorization = new Windows.Web.Http.Headers.HttpCredentialsHeaderValue("Bearer", _jwt);
            Windows.Web.Http.HttpResponseMessage response = await httpClient.GetAsync(new Uri($"{BackendUrl}{endpoint}"));
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsStringAsync();
        }

        public void CheckAuthenticationStatus()
        {
            string? jwt = DataStore.GetInstance().LoadJWT().GetJWT();
            UpdateUIForAuthStatus(!string.IsNullOrEmpty(jwt));
        }

        private void UpdateUIForAuthStatus(bool isAuthenticated)
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                SignInButton.Visibility = isAuthenticated ? Visibility.Collapsed : Visibility.Visible;
                SignOutButton.Visibility = isAuthenticated ? Visibility.Visible : Visibility.Collapsed;

                if (isAuthenticated)
                {
                    UserPicture.Visibility = Visibility.Visible;
                    UserNameText.Visibility = Visibility.Visible;
                    UserNameText.Text = localSettings.Values["UserName"] as string ?? "User";

                    string? photoUrl = localSettings.Values["PhotoURL"] as string;
                    if (!string.IsNullOrEmpty(photoUrl))
                    {
                        UserPicture.ProfilePicture = new BitmapImage(new Uri(photoUrl));
                    }
                }
                else
                {
                    UserPicture.Visibility = Visibility.Collapsed;
                    UserNameText.Visibility = Visibility.Collapsed;
                }
            });
        }

        private async void SignInButton_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                await Launcher.LaunchUriAsync(new Uri(BackendUrl + "/login"));
            }
            catch (Exception ex)
            {
                ContentDialog dialog = new()
                {
                    Title = "Error",
                    Content = $"Failed to initiate sign-in: {ex.Message}",
                    CloseButtonText = "OK",
                    XamlRoot = this.Content.XamlRoot
                };
                await dialog.ShowAsync();
            }
        }

        private async void SignOutButton_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                // Clear stored token and user info
                DataStore.GetInstance().SetJWT(null).SaveJWT();
                //localSettings.Values.Remove("UserName");
                //localSettings.Values.Remove("AuthState");

                // Update UI
                UpdateUIForAuthStatus(false);

                // Optional: Sign out from server
                // await SignOutFromServer();

                ContentDialog dialog = new()
                {
                    Title = "Signed Out",
                    Content = "You have been successfully signed out.",
                    CloseButtonText = "OK",
                    XamlRoot = this.Content.XamlRoot
                };
                await dialog.ShowAsync();
            }
            catch (Exception ex)
            {
                ContentDialog dialog = new ContentDialog
                {
                    Title = "Error",
                    Content = $"Error during sign-out: {ex.Message}",
                    CloseButtonText = "OK",
                    XamlRoot = this.Content.XamlRoot
                };
                await dialog.ShowAsync();
            }
        }

        private async Task FetchAndSaveUserInfo(string token)
        {
            try
            {
                httpClient.DefaultRequestHeaders.Authorization =
                    new Windows.Web.Http.Headers.HttpCredentialsHeaderValue("Bearer", token);

                var response = await httpClient.GetAsync(new Uri(BackendUrl + "/api/auth/get-profile"));
                if (response.IsSuccessStatusCode)
                {
                    var userInfo = await response.Content.ReadAsStringAsync();
                    // Parse user info and save
                    var user = JsonConvert.DeserializeObject<UserInfo>(userInfo);
                    localSettings.Values["UserName"] = user!.Profile.DisplayName;
                    localSettings.Values["PhotoURL"] = user!.Profile.PhotoURL;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error fetching user info: {ex.Message}");
            }
        }

        public static void SaveSetting(String key, String value)
        {
            ApplicationDataContainer localSettings = ApplicationData.Current.LocalSettings;

            localSettings.Values[key] = value as Object;
        }

        public static void SaveSetting(String key, Object value)
        {
            ApplicationDataContainer localSettings = ApplicationData.Current.LocalSettings;

            localSettings.Values[key] = value;
        }

        public static async Task CopyFolderAsync(StorageFolder sourceFolder, StorageFolder destinationFolder)
        {
            try
            {
                // Copy files in the current folder
                var files = await sourceFolder.GetFilesAsync();
                foreach (var file in files)
                {
                    await file.CopyAsync(destinationFolder, file.Name, NameCollisionOption.ReplaceExisting);
                }

                // Recursively copy subfolders
                var folders = await sourceFolder.GetFoldersAsync();
                foreach (var folder in folders)
                {
                    var newDestinationFolder = await destinationFolder.CreateFolderAsync(folder.Name, CreationCollisionOption.OpenIfExists);
                    await CopyFolderAsync(folder, newDestinationFolder); // Recursive call
                }
            }
            catch (Exception ex)
            {
                String errorMessage = "Error copying folder: " + ex.Message;
                Debug.WriteLine(errorMessage);
            }
        }

        public static String LoadSetting(string key)
        {
            ApplicationDataContainer localSettings = ApplicationData.Current.LocalSettings;

            var values = localSettings.Values;

            var result = values.TryGetValue(key, out object? value);

            if (result)
            {
                try
                {
                    Debug.WriteLine(value);

                    return value!.ToString().As<String>();
                }
                catch (Exception)
                {
                    Debug.WriteLine("Failed to unbox the value.\n");
                }
            }

            return "";
        }

        public void NavigationView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
        {
            var selectedItem = sender.SelectedItem.As<NavigationViewItem>().Tag as string;

            if (selectedItem == "Home")
            {
                ContentFrame.Navigate(typeof(HomePage_SettingsWindow), args.RecommendedNavigationTransitionInfo);
            }
            else if (selectedItem == "Plugins")
            {
                ContentFrame.Navigate(typeof(PluginPage_SettingsWindow), args.RecommendedNavigationTransitionInfo);
            }
        }

        public void NavigationView_Loaded(Object sender, RoutedEventArgs e)
        {
            NavView.SelectedItem = NavView.MenuItems[0];
        }
    }

    public class Profile
    {
        [JsonProperty("displayName")]
        public string? DisplayName { get; set; }

        [JsonProperty("email")]
        public string? Email { get; set; }

        [JsonProperty("photoURL")]
        public string? PhotoURL { get; set; }
    }

    public class UserInfo
    {
        [JsonProperty("profile")]
        public required Profile Profile { get; set; }
    }
}