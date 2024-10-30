#include "pch.h"
#include "VSCodeConnector.h"

VSCodeConnector& VSCodeConnector::GetInstance()
{
	static VSCodeConnector instance;
	return instance;
}

void VSCodeConnector::SaveLastActiveWindow() {
	// Get the currently active window before your app becomes active
	HWND currentWindow = GetForegroundWindow();
	if (currentWindow != NULL) {
		previousWindow = currentWindow;
	}
}

bool VSCodeConnector::IsVSCodeActive() const
{
	wchar_t windowTitle[256];
	if (previousWindow != NULL) {
		GetWindowText(previousWindow, windowTitle, sizeof(windowTitle));

		std::wstring title(windowTitle);

		if (title.find(L"Visual Studio Code") != std::wstring::npos) {
			return true;
		}

	}
	return false;
}

std::string VSCodeConnector::sanitizeCodeChunk(const std::string& codeChunk) {
	std::string sanitizedChunk = codeChunk;

	// Remove any trailing unwanted characters like )) before the newline
	sanitizedChunk.erase(std::remove_if(sanitizedChunk.begin(), sanitizedChunk.end(),
		[](unsigned char c) { return !std::isprint(c) && c != '\n'; }),
		sanitizedChunk.end());

	return sanitizedChunk;
}

std::string VSCodeConnector::escapeNewlines(const std::string& codeChunk) {
	std::string escapedChunk;
	for (char ch : codeChunk) {
		if (ch == '\n') {
			escapedChunk += "\\n"; // Escape newlines as "\\n" in JSON
		}
		else {
			escapedChunk += ch;
		}
	}
	return escapedChunk;
}

using json = nlohmann::json;

bool VSCodeConnector::streamCodeToVSCode(const std::string& codeChunk, const SOCKET& ConnectSocket) {
	json jsonData;

	// Ensure codeChunk is a string before assigning it to json
	if (!codeChunk.empty()) {
		jsonData["codeChunk"] = codeChunk;  // This should be a string
	}
	else {
		// Handle the case where codeChunk is empty or invalid
		OutputDebugString(L"Code chunk is empty or invalid.");
		return false;
	}

	// Convert JSON object to a string
	std::string jsonString = jsonData.dump().c_str();  // Serializes to string with proper escaping

	std::string request = "POST /insert-code HTTP/1.1\r\n";
	request += "Host: 127.0.0.1:3000\r\n";
	request += "Content-Type: application/json\r\n";
	request += "Content-Length: " + std::to_string(jsonString.length()) + "\r\n";
	request += "Connection: keep-alive\r\n\r\n";  // Keep the connection open for streaming
	request += jsonString;

	// Send the chunk
	int iResult = send(ConnectSocket, request.c_str(), (int)request.length(), 0);
	if (iResult == SOCKET_ERROR) {
		OutputDebugString(L"Send failed: " + WSAGetLastError());
		return false;
	}

	return true;
}

bool VSCodeConnector::setupSocket(SOCKET& ConnectSocket) {
	WSADATA wsaData;
	struct addrinfo* result = NULL, * ptr = NULL, hints;
	const char* host = "127.0.0.1";
	const char* port = "3000";

	// Initialize Winsock
	int iResult = WSAStartup(MAKEWORD(2, 2), &wsaData);
	if (iResult != 0) {
		std::cerr << "WSAStartup failed: " << iResult << std::endl;
		return false;
	}

	ZeroMemory(&hints, sizeof(hints));
	hints.ai_family = AF_INET;
	hints.ai_socktype = SOCK_STREAM;
	hints.ai_protocol = IPPROTO_TCP;

	// Resolve the server address and port
	iResult = getaddrinfo(host, port, &hints, &result);
	if (iResult != 0) {
		std::cerr << "getaddrinfo failed: " << iResult << std::endl;
		WSACleanup();
		return false;
	}

	// Attempt to connect to the first address returned by getaddrinfo
	ptr = result;
	ConnectSocket = socket(ptr->ai_family, ptr->ai_socktype, ptr->ai_protocol);
	if (ConnectSocket == INVALID_SOCKET) {
		std::cerr << "Error at socket(): " << WSAGetLastError() << std::endl;
		freeaddrinfo(result);
		WSACleanup();
		return false;
	}

	// Connect to server
	iResult = connect(ConnectSocket, ptr->ai_addr, (int)ptr->ai_addrlen);
	if (iResult == SOCKET_ERROR) {
		std::cerr << "Unable to connect to server: " << WSAGetLastError() << std::endl;
		closesocket(ConnectSocket);
		freeaddrinfo(result);
		WSACleanup();
		return false;
	}

	freeaddrinfo(result);
	return true;
}

void VSCodeConnector::cleanupSocket(SOCKET ConnectSocket) {
	closesocket(ConnectSocket);
	WSACleanup();
}