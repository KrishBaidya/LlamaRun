using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Windows.Foundation;

namespace LlamaRun
{
    internal abstract class IAIService
    {
        public abstract Task TextGeneration(string model, string inputText);

        public abstract Span<string> GetModels();
        public abstract Task<bool> LoadModels();

        public abstract string GetServiceName();

        // Optional method for API key (can be implemented by subclasses if needed)
        public abstract void SetAPIKey(string apiKey);
        public virtual bool IsApiKeySet() { return true; }

        protected List<string>? models;
    }
}
