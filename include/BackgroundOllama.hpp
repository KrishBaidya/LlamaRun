//#include <pch.h>


Ollama startOllamaServer(std::string url = "http://localhost:11434") {
	return Ollama(url);
}

bool generateResponseText(std::string modelname, std::string prompt, std::function<void(const ollama::response&)> response_callback) {
	try
	{
		return ollama::generate(modelname, prompt , response_callback);
	}
	catch (const std::exception& e)
	{
		return e.what();
	}
}

bool LoadModelIntoMemory(std::string const name) {
	bool model_loaded = ollama::load_model(name);
	return model_loaded;
}

std::vector<std::string> ListModel() {
	// List the models available locally in the ollama server
	std::vector<std::string> models = ollama::list_models();
	return models;
};
