#include "service_core.h"

#include <iostream>
#include <memory>
#include <string>

namespace {

SERVICE_STATUS_HANDLE g_statusHandle = nullptr;
SERVICE_STATUS g_status{};
HANDLE g_stopEvent = nullptr;
std::unique_ptr<ServiceCore> g_core;

void ReportServiceStatus(DWORD state, DWORD error, DWORD waitHint)
{
    static DWORD checkpoint = 1;
    g_status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
    g_status.dwCurrentState = state;
    g_status.dwWin32ExitCode = error;
    g_status.dwWaitHint = waitHint;
    g_status.dwControlsAccepted = state == SERVICE_RUNNING
        ? SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN
        : 0;
    g_status.dwCheckPoint = state == SERVICE_RUNNING || state == SERVICE_STOPPED
        ? 0
        : checkpoint++;
    if (g_statusHandle != nullptr) {
        SetServiceStatus(g_statusHandle, &g_status);
    }
}

DWORD WINAPI ServiceControlHandler(
    DWORD control,
    DWORD,
    void*,
    void*)
{
    if (control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN) {
        ReportServiceStatus(SERVICE_STOP_PENDING, ERROR_SUCCESS, 15000);
        if (g_stopEvent != nullptr) {
            SetEvent(g_stopEvent);
        }
    }
    return ERROR_SUCCESS;
}

void WINAPI ServiceMain(DWORD, wchar_t**)
{
    g_statusHandle = RegisterServiceCtrlHandlerExW(
        PULSENET_LIMITER_SERVICE_NAME,
        ServiceControlHandler,
        nullptr);
    if (g_statusHandle == nullptr) {
        return;
    }

    ReportServiceStatus(SERVICE_START_PENDING, ERROR_SUCCESS, 15000);
    g_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (g_stopEvent == nullptr) {
        ReportServiceStatus(SERVICE_STOPPED, GetLastError(), 0);
        return;
    }

    g_core = std::make_unique<ServiceCore>();
    const DWORD result = g_core->Start();
    if (result != ERROR_SUCCESS) {
        g_core.reset();
        CloseHandle(g_stopEvent);
        g_stopEvent = nullptr;
        ReportServiceStatus(SERVICE_STOPPED, result, 0);
        return;
    }

    ReportServiceStatus(SERVICE_RUNNING, ERROR_SUCCESS, 0);
    WaitForSingleObject(g_stopEvent, INFINITE);
    g_core->Stop();
    g_core.reset();
    CloseHandle(g_stopEvent);
    g_stopEvent = nullptr;
    ReportServiceStatus(SERVICE_STOPPED, ERROR_SUCCESS, 0);
}

BOOL WINAPI ConsoleControlHandler(DWORD control)
{
    if ((control == CTRL_C_EVENT || control == CTRL_BREAK_EVENT || control == CTRL_CLOSE_EVENT) &&
        g_stopEvent != nullptr) {
        SetEvent(g_stopEvent);
        return TRUE;
    }
    return FALSE;
}

DWORD RunConsole()
{
    g_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (g_stopEvent == nullptr) {
        return GetLastError();
    }
    SetConsoleCtrlHandler(ConsoleControlHandler, TRUE);

    ServiceCore core;
    const DWORD result = core.Start();
    if (result != ERROR_SUCCESS) {
        CloseHandle(g_stopEvent);
        g_stopEvent = nullptr;
        return result;
    }

    std::wcout << L"PulseNetLimiter is running in console mode. Press Ctrl+C to stop.\n";
    WaitForSingleObject(g_stopEvent, INFINITE);
    core.Stop();
    SetConsoleCtrlHandler(ConsoleControlHandler, FALSE);
    CloseHandle(g_stopEvent);
    g_stopEvent = nullptr;
    return ERROR_SUCCESS;
}

DWORD InstallService()
{
    std::wstring executable(32768, L'\0');
    const DWORD length = GetModuleFileNameW(
        nullptr,
        executable.data(),
        static_cast<DWORD>(executable.size()));
    if (length == 0 || length >= executable.size()) {
        return GetLastError();
    }
    executable.resize(length);
    const std::wstring command = L"\"" + executable + L"\"";

    SC_HANDLE manager = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CREATE_SERVICE);
    if (manager == nullptr) {
        return GetLastError();
    }

    const wchar_t dependencies[] = L"BFE\0Tcpip\0";
    SC_HANDLE service = CreateServiceW(
        manager,
        PULSENET_LIMITER_SERVICE_NAME,
        L"PulseNet Bandwidth Limiter",
        SERVICE_CHANGE_CONFIG | SERVICE_START | SERVICE_QUERY_STATUS | DELETE,
        SERVICE_WIN32_OWN_PROCESS,
        SERVICE_AUTO_START,
        SERVICE_ERROR_NORMAL,
        command.c_str(),
        nullptr,
        nullptr,
        dependencies,
        nullptr,
        nullptr);
    DWORD result = ERROR_SUCCESS;
    if (service == nullptr) {
        result = GetLastError();
    } else {
        SERVICE_DESCRIPTIONW description{};
        description.lpDescription = const_cast<wchar_t*>(
            L"Applies PulseNet per-application bandwidth limits through Windows Filtering Platform.");
        ChangeServiceConfig2W(service, SERVICE_CONFIG_DESCRIPTION, &description);

        SERVICE_DELAYED_AUTO_START_INFO delayed{};
        delayed.fDelayedAutostart = TRUE;
        ChangeServiceConfig2W(service, SERVICE_CONFIG_DELAYED_AUTO_START_INFO, &delayed);
        CloseServiceHandle(service);
    }
    CloseServiceHandle(manager);
    return result;
}

DWORD UninstallService()
{
    SC_HANDLE manager = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
    if (manager == nullptr) {
        return GetLastError();
    }
    SC_HANDLE service = OpenServiceW(
        manager,
        PULSENET_LIMITER_SERVICE_NAME,
        SERVICE_STOP | SERVICE_QUERY_STATUS | DELETE);
    if (service == nullptr) {
        const DWORD result = GetLastError();
        CloseServiceHandle(manager);
        return result;
    }

    SERVICE_STATUS status{};
    ControlService(service, SERVICE_CONTROL_STOP, &status);
    for (int attempt = 0; attempt < 50; ++attempt) {
        SERVICE_STATUS_PROCESS processStatus{};
        DWORD bytesNeeded = 0;
        if (!QueryServiceStatusEx(
                service,
                SC_STATUS_PROCESS_INFO,
                reinterpret_cast<BYTE*>(&processStatus),
                sizeof(processStatus),
                &bytesNeeded) ||
            processStatus.dwCurrentState == SERVICE_STOPPED) {
            break;
        }
        Sleep(100);
    }

    const BOOL deleted = DeleteService(service);
    const DWORD result = deleted ? ERROR_SUCCESS : GetLastError();
    CloseServiceHandle(service);
    CloseServiceHandle(manager);
    return result;
}

} // namespace

int wmain(int argc, wchar_t** argv)
{
    if (argc > 1) {
        const std::wstring command = argv[1];
        DWORD result = ERROR_INVALID_PARAMETER;
        if (command == L"--console") {
            result = RunConsole();
        } else if (command == L"install") {
            result = InstallService();
        } else if (command == L"uninstall") {
            result = UninstallService();
        }
        if (result != ERROR_SUCCESS) {
            std::wcerr << L"PulseNetLimiter failed with Win32 error " << result << L".\n";
        }
        return static_cast<int>(result);
    }

    SERVICE_TABLE_ENTRYW serviceTable[] = {
        {const_cast<wchar_t*>(PULSENET_LIMITER_SERVICE_NAME), ServiceMain},
        {nullptr, nullptr},
    };
    if (!StartServiceCtrlDispatcherW(serviceTable)) {
        return static_cast<int>(GetLastError());
    }
    return 0;
}

