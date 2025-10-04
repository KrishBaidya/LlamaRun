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

        public DataStore SetModels(Dictionary<string, Model> data)
        {
            models = data;

            return this;
        }

        public Dictionary<string, Model> GetModels()
        {
            return models!;
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

        public List<MCP_Server> GetMCPServers()
        {
            return MCP_Servers;
        }

        public void SetMCPServers(List<MCP_Server> _Servers)
        {
            MCP_Servers = _Servers;
        }

        public void AddMCPServers(MCP_Server _Servers)
        {
            MCP_Servers.Add(_Servers);
        }

        public void RemoveMCPServers(MCP_Server _Servers)
        {
            MCP_Servers.Remove(_Servers);
        }

        private string selectedModel = String.Empty;
        private Dictionary<string, Model>? models = null;

        private float appOpacity = 15.0f;
        private List<MCP_Server> MCP_Servers = [];

        //private Point appDimension = new(38, 10);

        private string? JWT;
    }
}
