#include "service_core.h"

#include "ipc_server.h"

#include <winsvc.h>

ServiceCore::~ServiceCore()
{
    Stop();
}

DWORD ServiceCore::Start()
{
    std::lock_guard lock(mutex_);
    if (started_) {
        return ERROR_SUCCESS;
    }

    DWORD result = proxy_.Start();
    if (result != ERROR_SUCCESS) {
        return result;
    }

    result = wfp_.Initialize();
    if (result != ERROR_SUCCESS) {
        proxy_.Stop();
        return result;
    }

    ipc_ = std::make_unique<IpcServer>(*this);
    result = ipc_->Start();
    if (result != ERROR_SUCCESS) {
        ipc_.reset();
        wfp_.Shutdown();
        proxy_.Stop();
        return result;
    }

    started_ = true;
    return ERROR_SUCCESS;
}

void ServiceCore::Stop()
{
    std::unique_ptr<IpcServer> ipc;
    {
        std::lock_guard lock(mutex_);
        if (!started_ && !ipc_) {
            return;
        }
        started_ = false;
        ipc = std::move(ipc_);
    }

    if (ipc) {
        ipc->Stop();
    }

    std::lock_guard lock(mutex_);
    rules_.clear();
    wfp_.Shutdown();
    proxy_.Stop();
}

DWORD ServiceCore::ReplaceRules(const std::vector<LimiterRule>& rules)
{
    std::lock_guard lock(mutex_);
    if (!started_) {
        return ERROR_SERVICE_NOT_ACTIVE;
    }

    proxy_.ReplaceRules(rules);
    const DWORD result = wfp_.ApplyRules(
        rules,
        GetCurrentProcessId(),
        proxy_.PortV4(),
        proxy_.PortV6());
    if (result != ERROR_SUCCESS) {
        proxy_.ReplaceRules(rules_);
        return result;
    }

    rules_ = rules;
    return ERROR_SUCCESS;
}

bool ServiceCore::IsDriverRunning() const
{
    SC_HANDLE manager = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
    if (manager == nullptr) {
        return false;
    }
    SC_HANDLE service = OpenServiceW(manager, L"PulseNetWfp", SERVICE_QUERY_STATUS);
    if (service == nullptr) {
        CloseServiceHandle(manager);
        return false;
    }

    SERVICE_STATUS_PROCESS status{};
    DWORD bytesNeeded = 0;
    const BOOL queried = QueryServiceStatusEx(
        service,
        SC_STATUS_PROCESS_INFO,
        reinterpret_cast<BYTE*>(&status),
        sizeof(status),
        &bytesNeeded);
    CloseServiceHandle(service);
    CloseServiceHandle(manager);
    return queried && status.dwCurrentState == SERVICE_RUNNING;
}

uint32_t ServiceCore::StatusFlags() const
{
    std::lock_guard lock(mutex_);
    uint32_t flags = 0;
    if (started_) {
        flags |= PulseNetLimiterStatusServiceReady;
    }
    if (IsDriverRunning()) {
        flags |= PulseNetLimiterStatusDriverLoaded;
    }
    if (wfp_.IsReady()) {
        flags |= PulseNetLimiterStatusBfeReady;
    }
    if (proxy_.IsReady()) {
        flags |= PulseNetLimiterStatusProxyReady;
    }
    return flags;
}

uint32_t ServiceCore::ActiveRuleCount() const
{
    std::lock_guard lock(mutex_);
    return static_cast<uint32_t>(rules_.size());
}

