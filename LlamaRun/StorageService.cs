using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Windows.Storage;

namespace LlamaRun
{
    /// <summary>
    /// Interface for storage operations that works in both packaged and unpackaged scenarios
    /// </summary>
    public interface IStorageService
    {
        void SaveSetting(string key, object value);
        string LoadSetting(string key);
        Task<string> GetLocalFolderPathAsync();
        Task<StorageFile> CreateFileAsync(string fileName, CreationCollisionOption options);
        Task<StorageFile?> TryGetFileAsync(string fileName);
        Task<string> ReadTextAsync(StorageFile file);
        Task WriteTextAsync(StorageFile file, string content);
    }

    /// <summary>
    /// Storage service for packaged apps using ApplicationData
    /// </summary>
    public class PackagedStorageService : IStorageService
    {
        private readonly ApplicationDataContainer localSettings = ApplicationData.Current.LocalSettings;
        private readonly StorageFolder localFolder = ApplicationData.Current.LocalFolder;

        public void SaveSetting(string key, object value)
        {
            localSettings.Values[key] = value;
        }

        public string LoadSetting(string key)
        {
            if (localSettings.Values.TryGetValue(key, out object? value) && value != null)
            {
                return value.ToString() ?? string.Empty;
            }
            return string.Empty;
        }

        public Task<string> GetLocalFolderPathAsync()
        {
            return Task.FromResult(localFolder.Path);
        }

        public async Task<StorageFile> CreateFileAsync(string fileName, CreationCollisionOption options)
        {
            return await localFolder.CreateFileAsync(fileName, options);
        }

        public async Task<StorageFile?> TryGetFileAsync(string fileName)
        {
            return await localFolder.TryGetItemAsync(fileName) as StorageFile;
        }

        public async Task<string> ReadTextAsync(StorageFile file)
        {
            return await FileIO.ReadTextAsync(file);
        }

        public async Task WriteTextAsync(StorageFile file, string content)
        {
            await FileIO.WriteTextAsync(file, content);
        }
    }

    /// <summary>
    /// Storage service for unpackaged apps using file system APIs
    /// </summary>
    public class UnpackagedStorageService : IStorageService
    {
        private readonly string settingsFilePath;
        private readonly string localFolderPath;
        private Dictionary<string, object> settings;

        public UnpackagedStorageService()
        {
            // Use LocalApplicationData for unpackaged apps
            localFolderPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "LlamaRun");
            
            settingsFilePath = Path.Combine(localFolderPath, "settings.json");

            // Ensure directory exists
            Directory.CreateDirectory(localFolderPath);

            // Load settings from file
            settings = LoadSettingsFromFile();
        }

        private Dictionary<string, object> LoadSettingsFromFile()
        {
            try
            {
                if (File.Exists(settingsFilePath))
                {
                    string json = File.ReadAllText(settingsFilePath);
                    return JsonSerializer.Deserialize<Dictionary<string, object>>(json) 
                           ?? new Dictionary<string, object>();
                }
            }
            catch (Exception ex)
            {
                // If file is corrupted or doesn't exist, start fresh
                System.Diagnostics.Debug.WriteLine($"Failed to load settings: {ex.Message}");
            }
            return new Dictionary<string, object>();
        }

        private void SaveSettingsToFile()
        {
            try
            {
                string json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(settingsFilePath, json);
            }
            catch (Exception ex)
            {
                // Failed to save settings - log for debugging
                System.Diagnostics.Debug.WriteLine($"Failed to save settings: {ex.Message}");
            }
        }

        public void SaveSetting(string key, object value)
        {
            settings[key] = value;
            SaveSettingsToFile();
        }

        public string LoadSetting(string key)
        {
            if (settings.TryGetValue(key, out object? value) && value != null)
            {
                // Handle JsonElement from deserialization
                if (value is JsonElement element)
                {
                    return element.ToString();
                }
                return value.ToString() ?? string.Empty;
            }
            return string.Empty;
        }

        public async Task<string> GetLocalFolderPathAsync()
        {
            return await Task.FromResult(localFolderPath);
        }

        public async Task<StorageFile> CreateFileAsync(string fileName, CreationCollisionOption options)
        {
            string filePath = Path.Combine(localFolderPath, fileName);
            
            // Handle collision options
            if (options == CreationCollisionOption.FailIfExists && File.Exists(filePath))
            {
                throw new IOException($"File already exists: {fileName}");
            }
            else if (options == CreationCollisionOption.GenerateUniqueName && File.Exists(filePath))
            {
                // Generate unique name
                string nameWithoutExtension = Path.GetFileNameWithoutExtension(fileName);
                string extension = Path.GetExtension(fileName);
                int counter = 1;
                while (File.Exists(filePath))
                {
                    fileName = $"{nameWithoutExtension} ({counter}){extension}";
                    filePath = Path.Combine(localFolderPath, fileName);
                    counter++;
                }
            }
            
            // Create or open the file
            if (!File.Exists(filePath) || options != CreationCollisionOption.OpenIfExists)
            {
                File.WriteAllText(filePath, string.Empty);
            }

            return await StorageFile.GetFileFromPathAsync(filePath);
        }

        public async Task<StorageFile?> TryGetFileAsync(string fileName)
        {
            string filePath = Path.Combine(localFolderPath, fileName);
            if (File.Exists(filePath))
            {
                return await StorageFile.GetFileFromPathAsync(filePath);
            }
            return null;
        }

        public async Task<string> ReadTextAsync(StorageFile file)
        {
            return await FileIO.ReadTextAsync(file);
        }

        public async Task WriteTextAsync(StorageFile file, string content)
        {
            await FileIO.WriteTextAsync(file, content);
        }
    }

    /// <summary>
    /// Factory to create the appropriate storage service based on packaging status
    /// </summary>
    public static class StorageServiceFactory
    {
        private static IStorageService? _instance;

        public static IStorageService GetStorageService()
        {
            if (_instance != null)
                return _instance;

            // Try to detect if app is packaged
            try
            {
                // This will throw if app is unpackaged
                var test = ApplicationData.Current;
                _instance = new PackagedStorageService();
            }
            catch
            {
                // App is unpackaged
                _instance = new UnpackagedStorageService();
            }

            return _instance;
        }
    }
}
