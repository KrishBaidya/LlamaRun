using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace LlamaRun
{
    partial class DataStore
    {
        private static DataStore? instance = null;
        public static DataStore GetInstance()
        {
            instance ??= new DataStore();
            return instance;
        }

        public DataStore SetSelectedModel(string data)
        {

            Debug.WriteLine("SetSelectedModel called with: " + data);
            selectedModel = data;

            return this;
        }

        public string GetSelectedModel()
        {
            Debug.WriteLine("GetSelectedModel returning: " + selectedModel);
            return selectedModel;
        }

        public void SaveSelectedModel()
        {
            LlamaRun.SettingsWindow.SaveSetting("SelectedModel", selectedModel);
        }

        public DataStore LoadSelectedModel()
        {
            selectedModel = LlamaRun.SettingsWindow.LoadSetting("SelectedModel");

            return this;
        }

        public float GetAppOpacity()
        {
            return appOpacity;
        }

        public DataStore SetAppOpacity(float opacity)
        {
            appOpacity = opacity;

            return this;
        }

        public void SaveAppOpacity()
        {
            LlamaRun.SettingsWindow.SaveSetting("AppOpacity", appOpacity);
        }

        public DataStore LoadAppOpacity()
        {
            appOpacity = int.Parse(LlamaRun.SettingsWindow.LoadSetting("AppOpacity"));

            return this;
        }

        //public Point GetAppDimension()
        //{
        //    return appDimension;
        //}

        //public DataStore SetAppDimension(Point _appDimension)
        //{
        //    appDimension = _appDimension;

        //    return this;
        //}

        //public void SaveAppDimension()
        //{
        //    LlamaRun.SettingsWindow.SaveSetting("Width", appDimension.X);
        //    LlamaRun.SettingsWindow.SaveSetting("Height", appDimension.Y);
        //}

        //public DataStore LoadAppDimension()
        //{
        //    int width = int.Parse(SettingsWindow.LoadSetting("Width"));
        //    int height = int.Parse(SettingsWindow.LoadSetting("Height"));

        //    Point point = new(width, height);

        //    this.appDimension = point;

        //    return this;
        //}

        public DataStore SetModels(IList<String> data)
        {
            models = data;

            return this;
        }

        public IList<String> GetModels()
        {
            return models!;
        }

        public DataStore SetModelService(string service)
        {
            if (service == null)
            {

            }
            else
            {
                selectedService = service;
            }

            return this;
        }

        public String GetModelService()
        {
            return selectedService;
        }

        public void SaveModelService()
        {
            LlamaRun.SettingsWindow.SaveSetting("ModelService", selectedService);
        }

        public DataStore LoadModelService()
        {
            selectedService = LlamaRun.SettingsWindow.LoadSetting("ModelService");

            return this;
        }

        public DataStore SetAPIKeyForProvider(String provider, String apiKey)
        {
            providerAPIKeys![provider] = apiKey;

            return this;
        }

        public String GetAPIKeyForProvider(String provider)
        {
            return providerAPIKeys![provider];
        }

        public void SaveAPIKeys()
        {
            var map = new Dictionary<String, String>();

            foreach (var pair in providerAPIKeys!)
            {
                map.Add(pair.Key, pair.Value);
            }

            LlamaRun.SettingsWindow.SaveSetting("APIKeys", WinRT.MarshalInspectable<Dictionary<String, String>>.FromManaged(map));
        }

        public DataStore LoadAPIKeys()
        {
            selectedService = LlamaRun.SettingsWindow.LoadSetting("APIKeys");

            return this;
        }

        public DataStore SetJWT(String? _jwt)
        {
            JWT = _jwt;

            return this;
        }

        public String GetJWT()
        {
            return JWT!;
        }

        public void SaveJWT()
        {
            LlamaRun.SettingsWindow.SaveSetting("JWT", JWT!);
        }

        public DataStore LoadJWT()
        {
            JWT = LlamaRun.SettingsWindow.LoadSetting("JWT");

            return this;
        }

        private string selectedModel = "";
        private IList<String>? models = null;

        private float appOpacity = 15.0f;

        //private Point appDimension = new(38, 10);

        private string selectedService = "";
        private Dictionary<string, string>? providerAPIKeys = null;

        private string? JWT;
    }
}
