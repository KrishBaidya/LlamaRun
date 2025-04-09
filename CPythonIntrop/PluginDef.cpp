#include "pch.h"
#include "PluginDef.h"
#include "PluginManagerIntrop.h" // Include this to access the stored provider

// Include necessary standard library headers
#include <vector>
#include <string>
#include <stdexcept> // For runtime_error

// Helper function to check if the provider is set
inline bool CheckProviderSet(const char* funcName) {
	if (!winrt::CPythonIntrop::implementation::PluginManagerIntrop::m_appDataProvider) {
		std::string error_msg = std::string(funcName) + ": AppDataProvider has not been set from the main application.";
		PyErr_SetString(PyExc_RuntimeError, error_msg.c_str());
		return false;
	}
	return true;
}

// --- C Function Implementations using the Callback ---

static PyObject* MyApp_GetSelectedModel(PyObject* self, PyObject* args) {
	if (!CheckProviderSet("get_selected_model")) return NULL;
	try {
		// Call the method on the stored interface pointer
		winrt::hstring model = winrt::CPythonIntrop::implementation::PluginManagerIntrop::m_appDataProvider.GetSelectedModel();
		return PyUnicode_FromString(winrt::to_string(model).c_str());
	}
	catch (const winrt::hresult_error& e) {
		std::string error_msg = "WinRT Error calling GetSelectedModel callback: " + winrt::to_string(e.message());
		PyErr_SetString(PyExc_RuntimeError, error_msg.c_str()); return NULL;
	}
	catch (...) { PyErr_SetString(PyExc_RuntimeError, "Unknown error in GetSelectedModel callback."); return NULL; }
}

static PyObject* MyApp_GetSelectedService(PyObject* self, PyObject* args) {
	if (!CheckProviderSet("get_selected_service")) return NULL;
	try {
		winrt::hstring service = winrt::CPythonIntrop::implementation::PluginManagerIntrop::m_appDataProvider.GetSelectedService();
		return PyUnicode_FromString(winrt::to_string(service).c_str());
	}
	catch (const winrt::hresult_error& e) {
		std::string error_msg = "WinRT Error calling GetSelectedService callback: " + winrt::to_string(e.message());
		PyErr_SetString(PyExc_RuntimeError, error_msg.c_str()); return NULL;
	}
	catch (...) { PyErr_SetString(PyExc_RuntimeError, "Unknown error in GetSelectedService callback."); return NULL; }
}

static PyObject* MyApp_GetAvailableModels(PyObject* self, PyObject* args) {
	if (!CheckProviderSet("get_available_models")) return NULL;
	try {
		auto modelsVector = winrt::CPythonIntrop::implementation::PluginManagerIntrop::m_appDataProvider.GetAvailableModels();
		PyObject* pyList = PyList_New(0);
		if (!pyList) return NULL;
		for (const auto& model : modelsVector) {
			PyObject* pyModel = PyUnicode_FromString(winrt::to_string(model).c_str());
			if (!pyModel) { Py_DECREF(pyList); return NULL; }
			if (PyList_Append(pyList, pyModel) == -1) { Py_DECREF(pyModel); Py_DECREF(pyList); return NULL; }
			Py_DECREF(pyModel);
		}
		return pyList;
	}
	catch (const winrt::hresult_error& e) {
		std::string error_msg = "WinRT Error calling GetAvailableModels callback: " + winrt::to_string(e.message());
		PyErr_SetString(PyExc_RuntimeError, error_msg.c_str()); return NULL;
	}
	catch (...) { PyErr_SetString(PyExc_RuntimeError, "Unknown error in GetAvailableModels callback."); return NULL; }
}

static PyObject* MyApp_IsAuthenticated(PyObject* self, PyObject* args) {
	if (!CheckProviderSet("is_authenticated")) return NULL;
	try {
		bool isAuthenticated = winrt::CPythonIntrop::implementation::PluginManagerIntrop::m_appDataProvider.IsAuthenticated();
		return PyBool_FromLong(isAuthenticated);
	}
	catch (const winrt::hresult_error& e) {
		std::string error_msg = "WinRT Error calling IsAuthenticated callback: " + winrt::to_string(e.message());
		PyErr_SetString(PyExc_RuntimeError, error_msg.c_str()); return NULL;
	}
	catch (...) { PyErr_SetString(PyExc_RuntimeError, "Unknown error in IsAuthenticated callback."); return NULL; }
}

static PyObject* MyApp_GetInputText(PyObject* self, PyObject* args) {
	if (!CheckProviderSet("get_input_text")) return NULL;
	try {
		// Synchronous call - C# implementation must handle thread safety or return error
		winrt::hstring text = winrt::CPythonIntrop::implementation::PluginManagerIntrop::m_appDataProvider.GetInputText();
		return PyUnicode_FromString(winrt::to_string(text).c_str());
	}
	catch (const winrt::hresult_error& e) { // Catch potential 'wrong thread' errors from C# if it throws
		std::string error_msg = "WinRT Error calling GetInputText callback (check C# thread safety): " + winrt::to_string(e.message());
		PyErr_SetString(PyExc_RuntimeError, error_msg.c_str()); return NULL;
	}
	catch (...) { PyErr_SetString(PyExc_RuntimeError, "Unknown error in GetInputText callback."); return NULL; }
}

static PyObject* MyApp_SetInputText(PyObject* self, PyObject* args) {
	if (!CheckProviderSet("set_input_text")) return NULL;
	const char* text_cstr;
	if (!PyArg_ParseTuple(args, "s", &text_cstr)) { return NULL; }
	try {
		winrt::hstring text = winrt::to_hstring(text_cstr);
		// Call the ASYNC method on the interface
		winrt::Windows::Foundation::IAsyncAction asyncAction = winrt::CPythonIntrop::implementation::PluginManagerIntrop::m_appDataProvider.SetInputTextAsync(text);
		// C++ cannot easily 'await' here to return something to Python.
		// We fire-and-forget the async action. Python continues immediately.
		// If Python *needs* to know when it's done, the design gets more complex (e.g., Python polling or another callback).
		Py_RETURN_NONE;
	}
	catch (const winrt::hresult_error& e) {
		std::string error_msg = "WinRT Error calling SetInputTextAsync callback: " + winrt::to_string(e.message());
		PyErr_SetString(PyExc_RuntimeError, error_msg.c_str()); return NULL;
	}
	catch (...) { PyErr_SetString(PyExc_RuntimeError, "Unknown error in SetInputTextAsync callback."); return NULL; }
}

// --- Python Module Definition (Uses the new C function pointers) ---

static PyMethodDef MyAppMethods[] = {
	{"get_selected_model", MyApp_GetSelectedModel, METH_NOARGS, "Get the name of the currently selected AI model."},
	{"get_selected_service", MyApp_GetSelectedService, METH_NOARGS, "Get the name of the currently selected AI service (e.g., Ollama)."},
	{"get_available_models", MyApp_GetAvailableModels, METH_NOARGS, "Get a list of available models for the current service."},
	{"is_authenticated", MyApp_IsAuthenticated, METH_NOARGS, "Check if the user is currently signed in."},
	{"get_input_text", MyApp_GetInputText, METH_NOARGS, "Get the current text from the main input box."},
	{"set_input_text", MyApp_SetInputText, METH_VARARGS, "Set the text in the main input box (async). Expects one string argument."},
	{NULL, NULL, 0, NULL} // Sentinel
};

// Module definition
static struct PyModuleDef myappmodule = {
	PyModuleDef_HEAD_INIT,
	"myapp",
	NULL,
	-1,
	MyAppMethods
};

// Module initialization function
PyMODINIT_FUNC PyInit_myapp(void) {
	return PyModule_Create(&myappmodule);
}