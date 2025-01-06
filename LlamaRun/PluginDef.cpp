#include "pch.h"
#include "PluginDef.h"


static PyObject* MyApp_SomeFunction(PyObject* self, PyObject* args) {
    // Parse input arguments
    const char* input_str;
    if (!PyArg_ParseTuple(args, "s", &input_str)) {
        return NULL;
    }

    PyObject* result = Py_BuildValue("s", "Processed: " + std::string(input_str));
    return result;
}

static PyObject* MyApp_GetProductivityData(PyObject* self, PyObject* args) {
    // Create a Python dictionary to return complex data
    PyObject* dict = PyDict_New();
    PyDict_SetItemString(dict, "tasks_completed", PyLong_FromLong(10));
    PyDict_SetItemString(dict, "productivity_score", PyFloat_FromDouble(85.5));

    return dict;
}

static PyMethodDef MyAppMethods[] = {
    {"some_function", MyApp_SomeFunction, METH_VARARGS, "Execute a function in the app"},
    {"get_productivity_data", MyApp_GetProductivityData, METH_NOARGS, "Retrieve productivity metrics"},
    {NULL, NULL, 0, NULL}
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