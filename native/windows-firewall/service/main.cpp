#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <iphlpapi.h>
#include <netfw.h>
#include <sddl.h>
#include <tcpestats.h>
#include <winsvc.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <cstring>
#include <cwctype>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "..\shared\pulsenet_network_control.h"
#include "wfp_blocker.h"

using Microsoft::WRL::ComPtr;

namespace {

constexpr wchar_t kFirewallGroup[] = L"PulseNet Network Control";
constexpr wchar_t kRulePrefix[] = L"PulseNet Block";

struct NetworkRule {
    GUID id{};
    std::wstring path;
    std::wstring name;
    bool blocked = false;
};

struct ApplicationUsage {
    std::wstring path;
    std::wstring name;
    uint64_t downloadBytes = 0;
};

struct TcpConnectionKey {
    DWORD pid = 0;
    DWORD localAddress = 0;
    DWORD localPort = 0;
    DWORD remoteAddress = 0;
    DWORD remotePort = 0;

    bool operator==(const TcpConnectionKey& other) const noexcept
    {
        return pid == other.pid && localAddress == other.localAddress &&
            localPort == other.localPort && remoteAddress == other.remoteAddress &&
            remotePort == other.remotePort;
    }
};

struct TcpConnectionKeyHash {
    size_t operator()(const TcpConnectionKey& value) const noexcept
    {
        size_t hash = static_cast<size_t>(value.pid);
        for (const DWORD part : {
                 value.localAddress,
                 value.localPort,
                 value.remoteAddress,
                 value.remotePort}) {
            hash ^= static_cast<size_t>(part) + static_cast<size_t>(0x9e3779b9u) +
                (hash << 6) + (hash >> 2);
        }
        return hash;
    }
};

struct TcpConnectionSample {
    uint64_t receivedBytes = 0;
    std::wstring usageKey;
    std::wstring path;
    std::wstring name;
};

struct GuidHash {
    size_t operator()(const GUID& value) const noexcept
    {
        const auto* bytes = reinterpret_cast<const unsigned char*>(&value);
        size_t hash = static_cast<size_t>(1469598103934665603ull);
        for (size_t index = 0; index < sizeof(GUID); ++index) {
            hash ^= bytes[index];
            hash *= static_cast<size_t>(1099511628211ull);
        }
        return hash;
    }
};

struct GuidEqual {
    bool operator()(const GUID& left, const GUID& right) const noexcept
    {
        return std::memcmp(&left, &right, sizeof(GUID)) == 0;
    }
};

std::atomic_bool g_stopping{false};
SERVICE_STATUS_HANDLE g_statusHandle = nullptr;
SERVICE_STATUS g_status{};
HANDLE g_stopEvent = nullptr;
std::thread g_pipeThread;
std::thread g_usageThread;
std::atomic_uint32_t g_activeRuleCount{0};
std::atomic_bool g_firewallReady{false};
std::mutex g_usageMutex;
std::unordered_map<std::wstring, ApplicationUsage> g_applicationUsage;
std::unordered_map<TcpConnectionKey, TcpConnectionSample, TcpConnectionKeyHash> g_tcpSamples;
WfpBlocker g_wfpBlocker;

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

std::wstring RuleName(const GUID& id, NET_FW_RULE_DIRECTION direction)
{
    const auto* bytes = reinterpret_cast<const unsigned char*>(&id);
    std::wostringstream name;
    name << kRulePrefix << (direction == NET_FW_RULE_DIR_OUT ? L" Out " : L" In ");
    for (size_t index = 0; index < sizeof(GUID); ++index) {
        name << std::hex << std::setw(2) << std::setfill(L'0') << static_cast<unsigned>(bytes[index]);
    }
    return name.str();
}

DWORD HresultToWin32(HRESULT result)
{
    if (HRESULT_FACILITY(result) == FACILITY_WIN32) {
        return HRESULT_CODE(result);
    }
    return static_cast<DWORD>(result);
}

DWORD OpenFirewallRules(ComPtr<INetFwRules>* rules)
{
    ComPtr<INetFwPolicy2> policy;
    const HRESULT created = CoCreateInstance(
        __uuidof(NetFwPolicy2),
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(&policy));
    if (FAILED(created)) {
        return HresultToWin32(created);
    }
    const HRESULT loaded = policy->get_Rules(rules->ReleaseAndGetAddressOf());
    return FAILED(loaded) ? HresultToWin32(loaded) : ERROR_SUCCESS;
}

DWORD AddBlockRule(
    INetFwRules* rules,
    const NetworkRule& source,
    NET_FW_RULE_DIRECTION direction)
{
    ComPtr<INetFwRule> rule;
    HRESULT result = CoCreateInstance(
        __uuidof(NetFwRule),
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(&rule));
    if (FAILED(result)) {
        return HresultToWin32(result);
    }

    const std::wstring ruleName = RuleName(source.id, direction);
    const std::wstring description = L"Managed by PulseNet for " + source.name;
    BSTR name = SysAllocString(ruleName.c_str());
    BSTR descriptionValue = SysAllocString(description.c_str());
    BSTR path = SysAllocString(source.path.c_str());
    BSTR group = SysAllocString(kFirewallGroup);
    BSTR interfaceTypes = SysAllocString(L"All");
    if (name == nullptr || descriptionValue == nullptr || path == nullptr ||
        group == nullptr || interfaceTypes == nullptr) {
        result = E_OUTOFMEMORY;
    } else {
        result = rule->put_Name(name);
        if (SUCCEEDED(result)) result = rule->put_Description(descriptionValue);
        if (SUCCEEDED(result)) result = rule->put_ApplicationName(path);
        if (SUCCEEDED(result)) result = rule->put_Grouping(group);
        if (SUCCEEDED(result)) result = rule->put_Profiles(NET_FW_PROFILE2_ALL);
        if (SUCCEEDED(result)) result = rule->put_Protocol(NET_FW_IP_PROTOCOL_ANY);
        if (SUCCEEDED(result)) result = rule->put_Direction(direction);
        if (SUCCEEDED(result)) result = rule->put_Action(NET_FW_ACTION_BLOCK);
        if (SUCCEEDED(result)) result = rule->put_InterfaceTypes(interfaceTypes);
        if (SUCCEEDED(result)) result = rule->put_EdgeTraversal(VARIANT_FALSE);
        if (SUCCEEDED(result)) result = rule->put_Enabled(VARIANT_TRUE);
        if (SUCCEEDED(result)) result = rules->Add(rule.Get());
    }
    SysFreeString(interfaceTypes);
    SysFreeString(group);
    SysFreeString(path);
    SysFreeString(descriptionValue);
    SysFreeString(name);
    return FAILED(result) ? HresultToWin32(result) : ERROR_SUCCESS;
}

void RemoveRuleIfPresent(INetFwRules* rules, const std::wstring& ruleName)
{
    BSTR name = SysAllocString(ruleName.c_str());
    if (name != nullptr) {
        rules->Remove(name);
        SysFreeString(name);
    }
}

DWORD EnumerateManagedRuleNames(INetFwRules* rules, std::vector<std::wstring>* names)
{
    ComPtr<IUnknown> unknown;
    HRESULT result = rules->get__NewEnum(unknown.GetAddressOf());
    if (FAILED(result)) {
        return HresultToWin32(result);
    }
    ComPtr<IEnumVARIANT> enumerator;
    result = unknown.As(&enumerator);
    if (FAILED(result)) {
        return HresultToWin32(result);
    }

    VARIANT item;
    VariantInit(&item);
    ULONG fetched = 0;
    while (enumerator->Next(1, &item, &fetched) == S_OK && fetched == 1) {
        if (item.vt == VT_DISPATCH && item.pdispVal != nullptr) {
            ComPtr<INetFwRule> rule;
            if (SUCCEEDED(item.pdispVal->QueryInterface(IID_PPV_ARGS(&rule)))) {
                BSTR group = nullptr;
                BSTR name = nullptr;
                if (SUCCEEDED(rule->get_Grouping(&group)) && group != nullptr &&
                    std::wstring(group, SysStringLen(group)) == kFirewallGroup &&
                    SUCCEEDED(rule->get_Name(&name)) && name != nullptr) {
                    names->emplace_back(name, SysStringLen(name));
                }
                SysFreeString(name);
                SysFreeString(group);
            }
        }
        VariantClear(&item);
        fetched = 0;
    }
    return ERROR_SUCCESS;
}

DWORD ReplaceClassicFirewallRules(const std::vector<NetworkRule>& requested)
{
    ComPtr<INetFwRules> rules;
    DWORD result = OpenFirewallRules(&rules);
    if (result != ERROR_SUCCESS) {
        g_firewallReady.store(false, std::memory_order_relaxed);
        return result;
    }
    g_firewallReady.store(true, std::memory_order_relaxed);

    std::unordered_set<std::wstring> desiredNames;
    uint32_t activeCount = 0;
    for (const auto& rule : requested) {
        if (!rule.blocked) {
            continue;
        }
        ++activeCount;
        for (const auto direction : {NET_FW_RULE_DIR_OUT, NET_FW_RULE_DIR_IN}) {
            const std::wstring name = RuleName(rule.id, direction);
            desiredNames.insert(name);
            RemoveRuleIfPresent(rules.Get(), name);
            result = AddBlockRule(rules.Get(), rule, direction);
            if (result != ERROR_SUCCESS) {
                return result;
            }
        }
    }

    std::vector<std::wstring> existingNames;
    result = EnumerateManagedRuleNames(rules.Get(), &existingNames);
    if (result != ERROR_SUCCESS) {
        return result;
    }
    for (const auto& name : existingNames) {
        if (desiredNames.find(name) == desiredNames.end()) {
            RemoveRuleIfPresent(rules.Get(), name);
        }
    }
    g_activeRuleCount.store(activeCount, std::memory_order_relaxed);
    return ERROR_SUCCESS;
}

DWORD ReplaceNetworkRules(const std::vector<NetworkRule>& requested)
{
    std::vector<WfpApplicationRule> blockedRules;
    blockedRules.reserve(requested.size());
    for (const auto& rule : requested) {
        if (rule.blocked) {
            blockedRules.push_back(WfpApplicationRule{rule.path, rule.name});
        }
    }

    const DWORD result = g_wfpBlocker.ReplaceRules(blockedRules);
    g_firewallReady.store(result == ERROR_SUCCESS, std::memory_order_relaxed);
    if (result != ERROR_SUCCESS) {
        return result;
    }

    // Keep matching Windows Firewall rules for compatibility when its profiles are enabled.
    ReplaceClassicFirewallRules(requested);
    g_firewallReady.store(true, std::memory_order_relaxed);
    g_activeRuleCount.store(static_cast<uint32_t>(blockedRules.size()), std::memory_order_relaxed);
    return ERROR_SUCCESS;
}

DWORD ParseRules(const std::vector<unsigned char>& payload, std::vector<NetworkRule>* rules)
{
    if (payload.size() < sizeof(PULSENET_NETWORK_RULES_HEADER)) {
        return ERROR_INVALID_DATA;
    }
    PULSENET_NETWORK_RULES_HEADER header{};
    std::memcpy(&header, payload.data(), sizeof(header));
    if (header.reserved != 0 || header.ruleCount > 4096) {
        return ERROR_INVALID_DATA;
    }

    size_t offset = sizeof(header);
    std::unordered_set<GUID, GuidHash, GuidEqual> identifiers;
    rules->clear();
    rules->reserve(header.ruleCount);
    for (uint32_t index = 0; index < header.ruleCount; ++index) {
        if (payload.size() - offset < sizeof(PULSENET_NETWORK_RULE_WIRE)) {
            return ERROR_INVALID_DATA;
        }
        PULSENET_NETWORK_RULE_WIRE wire{};
        std::memcpy(&wire, payload.data() + offset, sizeof(wire));
        offset += sizeof(wire);
        if (wire.reserved != 0 || wire.enabled > 1 || wire.pathChars == 0 ||
            wire.pathChars > PULSENET_NETWORK_MAX_PATH_CHARS ||
            wire.nameChars > PULSENET_NETWORK_MAX_PATH_CHARS) {
            return ERROR_INVALID_DATA;
        }
        const uint64_t characters = static_cast<uint64_t>(wire.pathChars) + wire.nameChars;
        if (characters > std::numeric_limits<size_t>::max() / sizeof(wchar_t)) {
            return ERROR_ARITHMETIC_OVERFLOW;
        }
        const size_t stringBytes = static_cast<size_t>(characters) * sizeof(wchar_t);
        if (stringBytes > payload.size() - offset) {
            return ERROR_INVALID_DATA;
        }

        NetworkRule rule{};
        rule.id = wire.ruleId;
        rule.blocked = wire.enabled != 0;
        rule.path.assign(reinterpret_cast<const wchar_t*>(payload.data() + offset), wire.pathChars);
        offset += static_cast<size_t>(wire.pathChars) * sizeof(wchar_t);
        rule.name.assign(reinterpret_cast<const wchar_t*>(payload.data() + offset), wire.nameChars);
        offset += static_cast<size_t>(wire.nameChars) * sizeof(wchar_t);
        if (!IsAbsoluteExecutablePath(rule.path) || rule.name.find(L'\0') != std::wstring::npos ||
            !identifiers.insert(rule.id).second) {
            return ERROR_INVALID_DATA;
        }
        rules->push_back(std::move(rule));
    }
    return offset == payload.size() ? ERROR_SUCCESS : ERROR_INVALID_DATA;
}

std::wstring UsageNameFromPath(const std::wstring& path, DWORD pid)
{
    const size_t separator = path.find_last_of(L"\\/");
    const std::wstring name = separator == std::wstring::npos ? path : path.substr(separator + 1);
    if (!name.empty()) {
        return name;
    }
    if (pid == 4) {
        return L"System";
    }
    return L"PID " + std::to_wstring(pid);
}

void ResolveProcessIdentity(DWORD pid, std::wstring* path, std::wstring* name)
{
    path->clear();
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (process != nullptr) {
        std::wstring buffer(32768, L'\0');
        DWORD length = static_cast<DWORD>(buffer.size());
        if (QueryFullProcessImageNameW(process, 0, buffer.data(), &length) && length > 0) {
            buffer.resize(length);
            *path = std::move(buffer);
        }
        CloseHandle(process);
    }
    *name = UsageNameFromPath(*path, pid);
}

std::wstring UsageKey(const std::wstring& path, DWORD pid)
{
    if (path.empty()) {
        return L"#pid:" + std::to_wstring(pid);
    }
    std::wstring key = path;
    std::transform(key.begin(), key.end(), key.begin(), [](wchar_t value) {
        return static_cast<wchar_t>(std::towlower(value));
    });
    return key;
}

MIB_TCPROW BasicTcpRow(const MIB_TCPROW_OWNER_PID& owner)
{
    MIB_TCPROW row{};
    row.dwState = owner.dwState;
    row.dwLocalAddr = owner.dwLocalAddr;
    row.dwLocalPort = owner.dwLocalPort;
    row.dwRemoteAddr = owner.dwRemoteAddr;
    row.dwRemotePort = owner.dwRemotePort;
    return row;
}

bool EnableTcpDataStats(MIB_TCPROW* row)
{
    TCP_ESTATS_DATA_RW_v0 settings{};
    settings.EnableCollection = static_cast<BOOLEAN>(TcpBoolOptEnabled);
    return SetPerTcpConnectionEStats(
               row,
               TcpConnectionEstatsData,
               reinterpret_cast<PUCHAR>(&settings),
               0,
               sizeof(settings),
               0) == NO_ERROR;
}

bool ReadTcpReceivedBytes(MIB_TCPROW* row, uint64_t* receivedBytes)
{
    TCP_ESTATS_DATA_RW_v0 settings{};
    TCP_ESTATS_DATA_ROD_v0 data{};
    const ULONG result = GetPerTcpConnectionEStats(
        row,
        TcpConnectionEstatsData,
        reinterpret_cast<PUCHAR>(&settings),
        0,
        sizeof(settings),
        nullptr,
        0,
        0,
        reinterpret_cast<PUCHAR>(&data),
        0,
        sizeof(data));
    if (result != NO_ERROR || settings.EnableCollection != TcpBoolOptEnabled) {
        return false;
    }
    *receivedBytes = data.DataBytesIn;
    return true;
}

void AddApplicationDownload(const TcpConnectionSample& sample, uint64_t bytes)
{
    if (bytes == 0) {
        return;
    }
    std::lock_guard<std::mutex> lock(g_usageMutex);
    ApplicationUsage& usage = g_applicationUsage[sample.usageKey];
    usage.path = sample.path;
    usage.name = sample.name;
    usage.downloadBytes = usage.downloadBytes > std::numeric_limits<uint64_t>::max() - bytes
        ? std::numeric_limits<uint64_t>::max()
        : usage.downloadBytes + bytes;
}

void PollNetworkUsageOnce()
{
    DWORD size = 0;
    const DWORD first = GetExtendedTcpTable(
        nullptr,
        &size,
        FALSE,
        AF_INET,
        TCP_TABLE_OWNER_PID_ALL,
        0);
    if (first != ERROR_INSUFFICIENT_BUFFER || size < sizeof(MIB_TCPTABLE_OWNER_PID)) {
        return;
    }
    std::vector<unsigned char> buffer(size);
    if (GetExtendedTcpTable(
            buffer.data(),
            &size,
            FALSE,
            AF_INET,
            TCP_TABLE_OWNER_PID_ALL,
            0) != NO_ERROR) {
        return;
    }

    const auto* table = reinterpret_cast<const MIB_TCPTABLE_OWNER_PID*>(buffer.data());
    std::unordered_map<TcpConnectionKey, TcpConnectionSample, TcpConnectionKeyHash> nextSamples;
    nextSamples.reserve(table->dwNumEntries);
    for (DWORD index = 0; index < table->dwNumEntries; ++index) {
        const MIB_TCPROW_OWNER_PID& owner = table->table[index];
        if (owner.dwState != MIB_TCP_STATE_ESTAB || owner.dwOwningPid == 0) {
            continue;
        }

        const TcpConnectionKey key{
            owner.dwOwningPid,
            owner.dwLocalAddr,
            owner.dwLocalPort,
            owner.dwRemoteAddr,
            owner.dwRemotePort};
        MIB_TCPROW row = BasicTcpRow(owner);
        const auto previous = g_tcpSamples.find(key);
        if (previous == g_tcpSamples.end()) {
            if (!EnableTcpDataStats(&row)) {
                continue;
            }
            uint64_t receivedBytes = 0;
            if (!ReadTcpReceivedBytes(&row, &receivedBytes)) {
                continue;
            }
            TcpConnectionSample sample{};
            sample.receivedBytes = receivedBytes;
            ResolveProcessIdentity(owner.dwOwningPid, &sample.path, &sample.name);
            sample.usageKey = UsageKey(sample.path, owner.dwOwningPid);
            nextSamples.emplace(key, std::move(sample));
            continue;
        }

        uint64_t receivedBytes = 0;
        if (!ReadTcpReceivedBytes(&row, &receivedBytes)) {
            if (!EnableTcpDataStats(&row) || !ReadTcpReceivedBytes(&row, &receivedBytes)) {
                continue;
            }
        }
        TcpConnectionSample sample = previous->second;
        if (receivedBytes >= sample.receivedBytes) {
            AddApplicationDownload(sample, receivedBytes - sample.receivedBytes);
        }
        sample.receivedBytes = receivedBytes;
        nextSamples.emplace(key, std::move(sample));
    }
    g_tcpSamples = std::move(nextSamples);
}

void UsageLoop()
{
    while (!g_stopping.load(std::memory_order_relaxed)) {
        PollNetworkUsageOnce();
        if (WaitForSingleObject(g_stopEvent, 1000) != WAIT_TIMEOUT) {
            break;
        }
    }
}

uint32_t StatusFlags()
{
    uint32_t flags = PulseNetNetworkStatusServiceReady;
    if (g_firewallReady.load(std::memory_order_relaxed)) {
        flags |= PulseNetNetworkStatusFirewallReady;
    }
    return flags;
}

void WriteStatus(HANDLE pipe, const PULSENET_NETWORK_MESSAGE_HEADER& request, DWORD result)
{
    PULSENET_NETWORK_STATUS_RESPONSE response{};
    response.header.magic = PULSENET_NETWORK_IPC_MAGIC;
    response.header.protocolVersion = PULSENET_NETWORK_PROTOCOL_VERSION;
    response.header.command = request.command;
    response.header.payloadSize = sizeof(response) - sizeof(response.header);
    response.header.requestId = request.requestId;
    response.statusFlags = StatusFlags();
    response.win32Error = result;
    response.activeRuleCount = g_activeRuleCount.load(std::memory_order_relaxed);
    WriteExact(pipe, &response, sizeof(response));
}

void WriteUsage(HANDLE pipe, const PULSENET_NETWORK_MESSAGE_HEADER& request)
{
    std::vector<ApplicationUsage> entries;
    {
        std::lock_guard<std::mutex> lock(g_usageMutex);
        entries.reserve(g_applicationUsage.size());
        for (const auto& item : g_applicationUsage) {
            if (item.second.downloadBytes > 0) {
                entries.push_back(item.second);
            }
        }
    }
    std::sort(entries.begin(), entries.end(), [](const auto& left, const auto& right) {
        return left.downloadBytes > right.downloadBytes;
    });
    if (entries.size() > 64) {
        entries.resize(64);
    }

    std::vector<unsigned char> body;
    body.reserve(entries.size() * 96);
    uint32_t writtenEntries = 0;
    for (const auto& entry : entries) {
        if (entry.path.size() > PULSENET_NETWORK_MAX_PATH_CHARS ||
            entry.name.size() > PULSENET_NETWORK_MAX_PATH_CHARS) {
            continue;
        }
        PULSENET_NETWORK_USAGE_ENTRY_WIRE wire{};
        wire.downloadBytes = entry.downloadBytes;
        wire.pathChars = static_cast<uint32_t>(entry.path.size());
        wire.nameChars = static_cast<uint32_t>(entry.name.size());
        const size_t required = sizeof(wire) +
            (entry.path.size() + entry.name.size()) * sizeof(wchar_t);
        if (body.size() + required + sizeof(PULSENET_NETWORK_USAGE_RESPONSE_HEADER) >
            PULSENET_NETWORK_MAX_MESSAGE_SIZE) {
            break;
        }
        const auto* wireBytes = reinterpret_cast<const unsigned char*>(&wire);
        body.insert(body.end(), wireBytes, wireBytes + sizeof(wire));
        const auto appendText = [&body](const std::wstring& value) {
            const auto* bytes = reinterpret_cast<const unsigned char*>(value.data());
            body.insert(body.end(), bytes, bytes + value.size() * sizeof(wchar_t));
        };
        appendText(entry.path);
        appendText(entry.name);
        ++writtenEntries;
    }

    PULSENET_NETWORK_USAGE_RESPONSE_HEADER response{};
    response.header.magic = PULSENET_NETWORK_IPC_MAGIC;
    response.header.protocolVersion = PULSENET_NETWORK_PROTOCOL_VERSION;
    response.header.command = request.command;
    response.header.payloadSize = static_cast<uint32_t>(
        sizeof(response) - sizeof(response.header) + body.size());
    response.header.requestId = request.requestId;
    response.statusFlags = StatusFlags();
    response.win32Error = ERROR_SUCCESS;
    response.entryCount = writtenEntries;

    WriteExact(pipe, &response, sizeof(response));
    if (!body.empty()) {
        WriteExact(pipe, body.data(), static_cast<DWORD>(body.size()));
    }
}

void HandleClient(HANDLE pipe)
{
    PULSENET_NETWORK_MESSAGE_HEADER request{};
    if (!ReadExact(pipe, &request, sizeof(request))) {
        return;
    }
    if (request.magic != PULSENET_NETWORK_IPC_MAGIC ||
        request.protocolVersion != PULSENET_NETWORK_PROTOCOL_VERSION ||
        request.payloadSize > PULSENET_NETWORK_MAX_MESSAGE_SIZE) {
        WriteStatus(pipe, request, ERROR_INVALID_DATA);
        return;
    }
    std::vector<unsigned char> payload(request.payloadSize);
    if (!payload.empty() && !ReadExact(pipe, payload.data(), request.payloadSize)) {
        WriteStatus(pipe, request, ERROR_READ_FAULT);
        return;
    }

    DWORD result = ERROR_NOT_SUPPORTED;
    if (request.command == PulseNetNetworkCommandHandshake) {
        result = payload.empty() ? g_wfpBlocker.Initialize() : ERROR_INVALID_DATA;
        g_firewallReady.store(result == ERROR_SUCCESS, std::memory_order_relaxed);
    } else if (request.command == PulseNetNetworkCommandReplaceRules) {
        std::vector<NetworkRule> parsed;
        result = ParseRules(payload, &parsed);
        if (result == ERROR_SUCCESS) {
            result = ReplaceNetworkRules(parsed);
        }
    } else if (request.command == PulseNetNetworkCommandGetUsage && payload.empty()) {
        WriteUsage(pipe, request);
        return;
    }
    WriteStatus(pipe, request, result);
}

void PipeLoop()
{
    const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(comResult)) {
        return;
    }
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)",
            SDDL_REVISION_1,
            &descriptor,
            nullptr)) {
        CoUninitialize();
        return;
    }

    while (!g_stopping.load(std::memory_order_relaxed)) {
        SECURITY_ATTRIBUTES security{sizeof(security), descriptor, FALSE};
        HANDLE pipe = CreateNamedPipeW(
            PULSENET_NETWORK_PIPE_NAME,
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_UNLIMITED_INSTANCES,
            PULSENET_NETWORK_MAX_MESSAGE_SIZE,
            PULSENET_NETWORK_MAX_MESSAGE_SIZE,
            1000,
            &security);
        if (pipe == INVALID_HANDLE_VALUE) {
            Sleep(250);
            continue;
        }
        const BOOL connected = ConnectNamedPipe(pipe, nullptr);
        if ((connected || GetLastError() == ERROR_PIPE_CONNECTED) &&
            !g_stopping.load(std::memory_order_relaxed)) {
            HandleClient(pipe);
        }
        FlushFileBuffers(pipe);
        DisconnectNamedPipe(pipe);
        CloseHandle(pipe);
    }
    LocalFree(descriptor);
    CoUninitialize();
}

void WakePipe()
{
    HANDLE pipe = CreateFileW(
        PULSENET_NETWORK_PIPE_NAME,
        GENERIC_READ | GENERIC_WRITE,
        0,
        nullptr,
        OPEN_EXISTING,
        0,
        nullptr);
    if (pipe != INVALID_HANDLE_VALUE) {
        CloseHandle(pipe);
    }
}

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
    g_status.dwCheckPoint = state == SERVICE_RUNNING || state == SERVICE_STOPPED ? 0 : checkpoint++;
    if (g_statusHandle != nullptr) {
        SetServiceStatus(g_statusHandle, &g_status);
    }
}

DWORD WINAPI ServiceControlHandler(DWORD control, DWORD, void*, void*)
{
    if (control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN) {
        ReportServiceStatus(SERVICE_STOP_PENDING, ERROR_SUCCESS, 5000);
        g_stopping.store(true, std::memory_order_relaxed);
        WakePipe();
        SetEvent(g_stopEvent);
    }
    return ERROR_SUCCESS;
}

void WINAPI ServiceMain(DWORD, wchar_t**)
{
    g_statusHandle = RegisterServiceCtrlHandlerExW(
        PULSENET_NETWORK_SERVICE_NAME,
        ServiceControlHandler,
        nullptr);
    if (g_statusHandle == nullptr) return;
    ReportServiceStatus(SERVICE_START_PENDING, ERROR_SUCCESS, 5000);
    g_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (g_stopEvent == nullptr) {
        ReportServiceStatus(SERVICE_STOPPED, GetLastError(), 0);
        return;
    }
    g_stopping.store(false, std::memory_order_relaxed);
    g_pipeThread = std::thread(PipeLoop);
    g_usageThread = std::thread(UsageLoop);
    ReportServiceStatus(SERVICE_RUNNING, ERROR_SUCCESS, 0);
    WaitForSingleObject(g_stopEvent, INFINITE);
    if (g_pipeThread.joinable()) g_pipeThread.join();
    if (g_usageThread.joinable()) g_usageThread.join();
    g_wfpBlocker.Shutdown();
    CloseHandle(g_stopEvent);
    g_stopEvent = nullptr;
    ReportServiceStatus(SERVICE_STOPPED, ERROR_SUCCESS, 0);
}

DWORD WaitForServiceState(SC_HANDLE service, DWORD expectedState, DWORD timeoutMs)
{
    const ULONGLONG deadline = GetTickCount64() + timeoutMs;
    while (GetTickCount64() < deadline) {
        SERVICE_STATUS_PROCESS status{};
        DWORD bytesNeeded = 0;
        if (!QueryServiceStatusEx(
                service,
                SC_STATUS_PROCESS_INFO,
                reinterpret_cast<LPBYTE>(&status),
                sizeof(status),
                &bytesNeeded)) {
            return GetLastError();
        }
        if (status.dwCurrentState == expectedState) {
            return ERROR_SUCCESS;
        }
        Sleep(100);
    }
    return ERROR_TIMEOUT;
}

DWORD StopServiceForUpdate(SC_HANDLE service)
{
    SERVICE_STATUS_PROCESS status{};
    DWORD bytesNeeded = 0;
    if (!QueryServiceStatusEx(
            service,
            SC_STATUS_PROCESS_INFO,
            reinterpret_cast<LPBYTE>(&status),
            sizeof(status),
            &bytesNeeded)) {
        return GetLastError();
    }
    if (status.dwCurrentState == SERVICE_STOPPED) {
        return ERROR_SUCCESS;
    }
    if (status.dwCurrentState != SERVICE_STOP_PENDING) {
        SERVICE_STATUS ignored{};
        if (!ControlService(service, SERVICE_CONTROL_STOP, &ignored) &&
            GetLastError() != ERROR_SERVICE_NOT_ACTIVE) {
            return GetLastError();
        }
    }
    return WaitForServiceState(service, SERVICE_STOPPED, 15000);
}

DWORD PrepareServiceExecutable(std::wstring* executable)
{
    std::wstring source(32768, L'\0');
    const DWORD sourceLength = GetModuleFileNameW(
        nullptr,
        source.data(),
        static_cast<DWORD>(source.size()));
    if (sourceLength == 0 || sourceLength >= source.size()) {
        return GetLastError();
    }
    source.resize(sourceLength);

    std::wstring programData(32768, L'\0');
    const DWORD programDataLength = GetEnvironmentVariableW(
        L"ProgramData",
        programData.data(),
        static_cast<DWORD>(programData.size()));
    if (programDataLength == 0 || programDataLength >= programData.size()) {
        return GetLastError();
    }
    programData.resize(programDataLength);

    const std::wstring productDirectory = programData + L"\\PulseNet";
    const std::wstring serviceDirectory = productDirectory + L"\\NetworkControl";
    if (!CreateDirectoryW(productDirectory.c_str(), nullptr) &&
        GetLastError() != ERROR_ALREADY_EXISTS) {
        return GetLastError();
    }
    if (!CreateDirectoryW(serviceDirectory.c_str(), nullptr) &&
        GetLastError() != ERROR_ALREADY_EXISTS) {
        return GetLastError();
    }

    WIN32_FILE_ATTRIBUTE_DATA attributes{};
    if (!GetFileAttributesExW(source.c_str(), GetFileExInfoStandard, &attributes)) {
        return GetLastError();
    }
    std::wostringstream fileName;
    fileName << L"PulseNetNetworkControl-"
             << std::hex << attributes.ftLastWriteTime.dwHighDateTime
             << attributes.ftLastWriteTime.dwLowDateTime << L'-'
             << attributes.nFileSizeHigh << attributes.nFileSizeLow << L".exe";
    const std::wstring target = serviceDirectory + L"\\" + fileName.str();

    if (_wcsicmp(source.c_str(), target.c_str()) != 0 &&
        !CopyFileW(source.c_str(), target.c_str(), TRUE) &&
        GetLastError() != ERROR_FILE_EXISTS) {
        return GetLastError();
    }
    *executable = target;
    return ERROR_SUCCESS;
}

DWORD InstallService()
{
    std::wstring executable;
    const DWORD prepared = PrepareServiceExecutable(&executable);
    if (prepared != ERROR_SUCCESS) return prepared;
    const std::wstring command = L"\"" + executable + L"\"";
    SC_HANDLE manager = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CREATE_SERVICE);
    if (manager == nullptr) return GetLastError();
    const wchar_t dependencies[] = L"mpssvc\0\0";
    SC_HANDLE service = CreateServiceW(
        manager,
        PULSENET_NETWORK_SERVICE_NAME,
        L"PulseNet Network Control",
        SERVICE_CHANGE_CONFIG | SERVICE_START | SERVICE_STOP | SERVICE_QUERY_STATUS | DELETE,
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
    bool serviceExisted = false;
    if (service == nullptr && GetLastError() == ERROR_SERVICE_EXISTS) {
        serviceExisted = true;
        service = OpenServiceW(
            manager,
            PULSENET_NETWORK_SERVICE_NAME,
            SERVICE_CHANGE_CONFIG | SERVICE_START | SERVICE_STOP | SERVICE_QUERY_STATUS);
        if (service != nullptr && !ChangeServiceConfigW(
                service,
                SERVICE_NO_CHANGE,
                SERVICE_AUTO_START,
                SERVICE_NO_CHANGE,
                command.c_str(),
                nullptr,
                nullptr,
                dependencies,
                nullptr,
                nullptr,
                L"PulseNet Network Control")) {
            result = GetLastError();
        }
    } else if (service == nullptr) {
        result = GetLastError();
    }
    if (service != nullptr) {
        SERVICE_DESCRIPTIONW description{};
        description.lpDescription = const_cast<wchar_t*>(L"Manages PulseNet per-application Windows Firewall rules.");
        ChangeServiceConfig2W(service, SERVICE_CONFIG_DESCRIPTION, &description);
        if (result == ERROR_SUCCESS && serviceExisted) {
            result = StopServiceForUpdate(service);
        }
        if (result == ERROR_SUCCESS &&
            !StartServiceW(service, 0, nullptr) && GetLastError() != ERROR_SERVICE_ALREADY_RUNNING) {
            result = GetLastError();
        }
        if (result == ERROR_SUCCESS) {
            result = WaitForServiceState(service, SERVICE_RUNNING, 15000);
        }
        CloseServiceHandle(service);
    }
    CloseServiceHandle(manager);
    return result;
}

DWORD UninstallService()
{
    const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (SUCCEEDED(comResult)) {
        ReplaceNetworkRules({});
        CoUninitialize();
    }
    SC_HANDLE manager = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
    if (manager == nullptr) return GetLastError();
    SC_HANDLE service = OpenServiceW(manager, PULSENET_NETWORK_SERVICE_NAME, SERVICE_STOP | DELETE);
    if (service == nullptr) {
        const DWORD result = GetLastError();
        CloseServiceHandle(manager);
        return result;
    }
    SERVICE_STATUS status{};
    ControlService(service, SERVICE_CONTROL_STOP, &status);
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
        DWORD result = ERROR_INVALID_PARAMETER;
        const std::wstring command = argv[1];
        if (command == L"install") result = InstallService();
        else if (command == L"uninstall") result = UninstallService();
        if (result != ERROR_SUCCESS) {
            std::wcerr << L"PulseNetNetworkControl failed with Win32 error " << result << L".\n";
        }
        return static_cast<int>(result);
    }
    SERVICE_TABLE_ENTRYW serviceTable[] = {
        {const_cast<wchar_t*>(PULSENET_NETWORK_SERVICE_NAME), ServiceMain},
        {nullptr, nullptr},
    };
    return StartServiceCtrlDispatcherW(serviceTable) ? 0 : static_cast<int>(GetLastError());
}
