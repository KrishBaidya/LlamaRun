#include "pch.h"
#include "PluginDef.h"

// Declare the methods you want to expose
static PyObject* MyApp_SomeFunction(PyObject* self, PyObject* args) {
    // Parse input arguments
    const char* input_str;
    if (!PyArg_ParseTuple(args, "s", &input_str)) {
        return NULL;
    }

    // Perform your logic
    // Example: processing the input string
    PyObject* result = Py_BuildValue("s", "Processed: " + std::string(input_str));
    return result;
}

// Another example method
static PyObject* MyApp_GetProductivityData(PyObject* self, PyObject* args) {
    // Create a Python dictionary to return complex data
    PyObject* dict = PyDict_New();
    PyDict_SetItemString(dict, "tasks_completed", PyLong_FromLong(10));
    PyDict_SetItemString(dict, "productivity_score", PyFloat_FromDouble(85.5));

    return dict;
}

// Method definition object for this extension, these argumens mean:
// ml_name: The name of the method
// ml_meth: Function pointer to the method implementation
// ml_flags: Flags indicating special features of this method, such as
//          accepting arguments, accepting keyword arguments, being a class method, etc.
// ml_doc:  Contents of this method's docstring
static PyMethodDef MyAppMethods[] = {
    {"some_function", MyApp_SomeFunction, METH_VARARGS, "Execute a function in the app"},
    {"get_productivity_data", MyApp_GetProductivityData, METH_NOARGS, "Retrieve productivity metrics"},
    {NULL, NULL, 0, NULL}  // Sentinel
};

// Module definition
static struct PyModuleDef myappmodule = {
    PyModuleDef_HEAD_INIT,
    "myapp",   // name of module
    NULL,      // module documentation, may be NULL
    -1,        // size of per-interpreter state of the module, or -1 if the module keeps state in global variables.
    MyAppMethods
};

// Module initialization function
PyMODINIT_FUNC PyInit_myapp(void) {
    return PyModule_Create(&myappmodule);
}