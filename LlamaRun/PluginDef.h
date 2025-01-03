#pragma once

#define PY_SSIZE_T_CLEAN
#include <Python/Python.h>


static PyObject* MyApp_SomeFunction(PyObject* self, PyObject* args);
static PyObject* MyApp_GetProductivityData(PyObject* self, PyObject* args);

PyMODINIT_FUNC PyInit_myapp(void);