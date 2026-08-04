#include "ipc_server.h"

#include "service_core.h"

#include <sddl.h>

#include <cstring>
#include <cwctype>
#include <limits>
#include <unordered_set>

namespace {

static_assert(sizeof(PULSENET_LIMITER_MESSAGE_HEADER) == 20);
static_assert(sizeof(PULSENET_LIMITER_STATUS_RESPONSE) == 36);
static_assert(sizeof(PULSENET_LIMITER_RULES_HEADER) == 8);
static_assert(sizeof(PULSENET_LIMITER_RULE_WIRE) == 48);

bool ReadExact(HANDLE pipe, void* destination, DWORD size)
{
    auto* output = static_cast<unsigned char*>(destination);
    DWORD offset = 0;
    while (offset < size) {
        DWORD read = 0;
        if (!ReadFile(pipe, output + offset, size - offset, &read, nullptr) || read == 0) {
            return false;
        }
        offset += read;
    }
    return true;
}

bool WriteExact(HANDLE pipe, const void* source, DWORD size)
{
    const auto* input = static_cast<const unsigned char*>(source);
    DWORD offset = 0;
    while (offset < size) {
        DWORD written = 0;
        if (!WriteFile(pipe, input + offset, size - offset, &written, nullptr) || written == 0) {
            return false;
        }
        offset += written;
    }
    return true;
}

bool IsAbsoluteExecutablePath(const std::wstring& path)
{
    if (path.empty() || path.find(L'\0') != std::wstring::npos) {
        return false;
    }
    const bool drivePath = path.size() >= 3 && std::iswalpha(path[0]) && path[1] == L':' &&
        (path[2] == L'\\' || path[2] == L'/');
    const bool uncPath = path.size() >= 3 && path[0] == L'\\' && path[1] == L'\\';
    return drivePath || uncPath;
}

bool IsValidLimit(uint64_t value)
{
    return value == 0 ||
        (value >= PULSENET_LIMITER_MIN_BPS && value <= PULSENET_LIMITER_MAX_BPS);
}

} // namespace

IpcServer::IpcServer(ServiceCore& core)
    : core_(core)
{
}

IpcServer::~IpcServer()
{
    Stop();
}

DWORD IpcServer::Start()
{
    if (thread_.joinable()) {
        return ERROR_SUCCESS;
    }
    stopping_.store(false, std::memory_order_relaxed);
    try {
        thread_ = std::thread(&IpcServer::Run, this);
    } catch (...) {
        return ERROR_NOT_ENOUGH_MEMORY;
    }
    return ERROR_SUCCESS;
}

void IpcServer::Stop()
{
    if (!thread_.joinable()) {
        return;
    }
    stopping_.store(true, std::memory_order_relaxed);

    HANDLE wakePipe = CreateFileW(
        PULSENET_LIMITER_PIPE_NAME,
        GENERIC_READ | GENERIC_WRITE,
        0,
        nullptr,
        OPEN_EXISTING,
        0,
        nullptr);
    if (wakePipe != INVALID_HANDLE_VALUE) {
        CloseHandle(wakePipe);
    }
    thread_.join();
}

void IpcServer::Run()
{
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)",
            SDDL_REVISION_1,
            &descriptor,
            nullptr)) {
        return;
    }

    SECURITY_ATTRIBUTES security{};
    security.nLength = sizeof(security);
    security.lpSecurityDescriptor = descriptor;
    security.bInheritHandle = FALSE;

    while (!stopping_.load(std::memory_order_relaxed)) {
        HANDLE pipe = CreateNamedPipeW(
            PULSENET_LIMITER_PIPE_NAME,
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_UNLIMITED_INSTANCES,
            sizeof(PULSENET_LIMITER_STATUS_RESPONSE),
            PULSENET_LIMITER_MAX_MESSAGE_SIZE,
            1000,
            &security);
        if (pipe == INVALID_HANDLE_VALUE) {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            continue;
        }

        const BOOL connected = ConnectNamedPipe(pipe, nullptr);
        const DWORD connectError = connected ? ERROR_SUCCESS : GetLastError();
        if (connected || connectError == ERROR_PIPE_CONNECTED) {
            if (!stopping_.load(std::memory_order_relaxed)) {
                HandleClient(pipe);
            }
        }
        FlushFileBuffers(pipe);
        DisconnectNamedPipe(pipe);
        CloseHandle(pipe);
    }

    LocalFree(descriptor);
}

void IpcServer::HandleClient(HANDLE pipe)
{
    PULSENET_LIMITER_MESSAGE_HEADER request{};
    if (!ReadExact(pipe, &request, sizeof(request))) {
        return;
    }

    if (request.magic != PULSENET_LIMITER_IPC_MAGIC ||
        request.protocolVersion != PULSENET_LIMITER_PROTOCOL_VERSION ||
        request.payloadSize > PULSENET_LIMITER_MAX_MESSAGE_SIZE) {
        WriteStatus(pipe, request, ERROR_INVALID_DATA);
        return;
    }

    std::vector<unsigned char> payload(request.payloadSize);
    if (!payload.empty() && !ReadExact(pipe, payload.data(), request.payloadSize)) {
        WriteStatus(pipe, request, ERROR_READ_FAULT);
        return;
    }

    DWORD result = ERROR_INVALID_FUNCTION;
    switch (request.command) {
    case PulseNetLimiterCommandHandshake:
        result = payload.empty() ? ERROR_SUCCESS : ERROR_INVALID_DATA;
        break;
    case PulseNetLimiterCommandReplaceRules: {
        std::vector<LimiterRule> rules;
        result = ParseRules(payload, &rules);
        if (result == ERROR_SUCCESS) {
            result = core_.ReplaceRules(rules);
        }
        break;
    }
    default:
        result = ERROR_NOT_SUPPORTED;
        break;
    }

    WriteStatus(pipe, request, result);
}

DWORD IpcServer::ParseRules(
    const std::vector<unsigned char>& payload,
    std::vector<LimiterRule>* rules)
{
    if (payload.size() < sizeof(PULSENET_LIMITER_RULES_HEADER)) {
        return ERROR_INVALID_DATA;
    }

    PULSENET_LIMITER_RULES_HEADER rulesHeader{};
    std::memcpy(&rulesHeader, payload.data(), sizeof(rulesHeader));
    if (rulesHeader.reserved != 0 || rulesHeader.ruleCount > 4096) {
        return ERROR_INVALID_DATA;
    }

    size_t offset = sizeof(rulesHeader);
    rules->clear();
    rules->reserve(rulesHeader.ruleCount);
    std::unordered_set<GUID, GuidHash, GuidEqual> identifiers;

    for (uint32_t index = 0; index < rulesHeader.ruleCount; ++index) {
        if (payload.size() - offset < sizeof(PULSENET_LIMITER_RULE_WIRE)) {
            return ERROR_INVALID_DATA;
        }

        PULSENET_LIMITER_RULE_WIRE wire{};
        std::memcpy(&wire, payload.data() + offset, sizeof(wire));
        offset += sizeof(wire);

        if (wire.reserved != 0 || wire.enabled > 1 ||
            wire.pathChars == 0 || wire.pathChars > PULSENET_LIMITER_MAX_PATH_CHARS ||
            wire.nameChars > PULSENET_LIMITER_MAX_PATH_CHARS ||
            !IsValidLimit(wire.downloadLimitBps) || !IsValidLimit(wire.uploadLimitBps) ||
            (wire.downloadLimitBps == 0 && wire.uploadLimitBps == 0)) {
            return ERROR_INVALID_DATA;
        }

        const uint64_t characterCount =
            static_cast<uint64_t>(wire.pathChars) + static_cast<uint64_t>(wire.nameChars);
        if (characterCount > std::numeric_limits<size_t>::max() / sizeof(wchar_t)) {
            return ERROR_ARITHMETIC_OVERFLOW;
        }
        const size_t stringBytes = static_cast<size_t>(characterCount) * sizeof(wchar_t);
        if (stringBytes > payload.size() - offset) {
            return ERROR_INVALID_DATA;
        }

        LimiterRule rule{};
        rule.id = wire.ruleId;
        rule.downloadLimitBps = wire.downloadLimitBps;
        rule.uploadLimitBps = wire.uploadLimitBps;
        rule.enabled = wire.enabled != 0;
        rule.executablePath.assign(
            reinterpret_cast<const wchar_t*>(payload.data() + offset),
            wire.pathChars);
        offset += static_cast<size_t>(wire.pathChars) * sizeof(wchar_t);
        rule.processName.assign(
            reinterpret_cast<const wchar_t*>(payload.data() + offset),
            wire.nameChars);
        offset += static_cast<size_t>(wire.nameChars) * sizeof(wchar_t);

        if (!IsAbsoluteExecutablePath(rule.executablePath) ||
            rule.processName.find(L'\0') != std::wstring::npos ||
            !identifiers.insert(rule.id).second) {
            return ERROR_INVALID_DATA;
        }
        rules->push_back(std::move(rule));
    }

    return offset == payload.size() ? ERROR_SUCCESS : ERROR_INVALID_DATA;
}

bool IpcServer::WriteStatus(
    HANDLE pipe,
    const PULSENET_LIMITER_MESSAGE_HEADER& request,
    DWORD result)
{
    PULSENET_LIMITER_STATUS_RESPONSE response{};
    response.header.magic = PULSENET_LIMITER_IPC_MAGIC;
    response.header.protocolVersion = PULSENET_LIMITER_PROTOCOL_VERSION;
    response.header.command = request.command;
    response.header.payloadSize = sizeof(response) - sizeof(response.header);
    response.header.requestId = request.requestId;
    response.statusFlags = core_.StatusFlags();
    response.win32Error = result;
    response.activeRuleCount = core_.ActiveRuleCount();
    return WriteExact(pipe, &response, sizeof(response));
}

