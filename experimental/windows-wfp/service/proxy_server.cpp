#include "proxy_server.h"

#include <algorithm>
#include <array>

namespace {

bool SendAll(SOCKET socket, const char* data, size_t length)
{
    size_t offset = 0;
    while (offset < length) {
        const int sent = send(
            socket,
            data + offset,
            static_cast<int>(std::min<size_t>(length - offset, INT_MAX)),
            0);
        if (sent <= 0) {
            return false;
        }
        offset += static_cast<size_t>(sent);
    }
    return true;
}

bool QueryRedirectRecords(SOCKET socket, std::vector<unsigned char>* records)
{
    records->resize(4096);
    for (;;) {
        DWORD bytes = 0;
        const int result = WSAIoctl(
            socket,
            SIO_QUERY_WFP_CONNECTION_REDIRECT_RECORDS,
            nullptr,
            0,
            records->data(),
            static_cast<DWORD>(records->size()),
            &bytes,
            nullptr,
            nullptr);
        if (result == 0) {
            records->resize(bytes);
            return true;
        }
        if (WSAGetLastError() != WSAEFAULT || bytes <= records->size() ||
            bytes > PULSENET_LIMITER_MAX_MESSAGE_SIZE) {
            records->clear();
            return false;
        }
        records->resize(bytes);
    }
}

void ApplyRedirectRecords(SOCKET socket, const std::vector<unsigned char>& records)
{
    if (records.empty()) {
        return;
    }
    DWORD bytes = 0;
    WSAIoctl(
        socket,
        SIO_SET_WFP_CONNECTION_REDIRECT_RECORDS,
        const_cast<unsigned char*>(records.data()),
        static_cast<DWORD>(records.size()),
        nullptr,
        0,
        &bytes,
        nullptr,
        nullptr);
}

} // namespace

ProxyServer::~ProxyServer()
{
    Stop();
}

DWORD ProxyServer::CreateListener(int family, SOCKET* listener, uint16_t* port)
{
    SOCKET socket = WSASocketW(family, SOCK_STREAM, IPPROTO_TCP, nullptr, 0, 0);
    if (socket == INVALID_SOCKET) {
        return WSAGetLastError();
    }

    BOOL exclusive = TRUE;
    setsockopt(
        socket,
        SOL_SOCKET,
        SO_EXCLUSIVEADDRUSE,
        reinterpret_cast<const char*>(&exclusive),
        sizeof(exclusive));

    int bindResult = SOCKET_ERROR;
    if (family == AF_INET) {
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        address.sin_port = 0;
        bindResult = bind(socket, reinterpret_cast<const sockaddr*>(&address), sizeof(address));
    } else {
        DWORD v6Only = TRUE;
        setsockopt(
            socket,
            IPPROTO_IPV6,
            IPV6_V6ONLY,
            reinterpret_cast<const char*>(&v6Only),
            sizeof(v6Only));
        sockaddr_in6 address{};
        address.sin6_family = AF_INET6;
        address.sin6_addr = in6addr_loopback;
        address.sin6_port = 0;
        bindResult = bind(socket, reinterpret_cast<const sockaddr*>(&address), sizeof(address));
    }

    if (bindResult == SOCKET_ERROR || listen(socket, SOMAXCONN) == SOCKET_ERROR) {
        const DWORD error = WSAGetLastError();
        closesocket(socket);
        return error;
    }

    sockaddr_storage address{};
    int addressLength = sizeof(address);
    if (getsockname(socket, reinterpret_cast<sockaddr*>(&address), &addressLength) == SOCKET_ERROR) {
        const DWORD error = WSAGetLastError();
        closesocket(socket);
        return error;
    }

    *port = family == AF_INET
        ? ntohs(reinterpret_cast<const sockaddr_in*>(&address)->sin_port)
        : ntohs(reinterpret_cast<const sockaddr_in6*>(&address)->sin6_port);
    *listener = socket;
    return ERROR_SUCCESS;
}

DWORD ProxyServer::Start()
{
    if (IsReady()) {
        return ERROR_SUCCESS;
    }

    WSADATA data{};
    const int startupResult = WSAStartup(MAKEWORD(2, 2), &data);
    if (startupResult != 0) {
        return static_cast<DWORD>(startupResult);
    }
    winsockStarted_ = true;
    stopping_.store(false, std::memory_order_relaxed);

    DWORD result = CreateListener(AF_INET, &listenerV4_, &portV4_);
    if (result == ERROR_SUCCESS) {
        result = CreateListener(AF_INET6, &listenerV6_, &portV6_);
    }
    if (result != ERROR_SUCCESS) {
        Stop();
        return result;
    }

    acceptThreadV4_ = std::thread(&ProxyServer::AcceptLoop, this, listenerV4_);
    acceptThreadV6_ = std::thread(&ProxyServer::AcceptLoop, this, listenerV6_);
    return ERROR_SUCCESS;
}

bool ProxyServer::IsReady() const noexcept
{
    return winsockStarted_ && listenerV4_ != INVALID_SOCKET && listenerV6_ != INVALID_SOCKET;
}

void ProxyServer::ReplaceRules(const std::vector<LimiterRule>& rules)
{
    std::lock_guard lock(runtimeMutex_);
    RuntimeMap next;
    for (const auto& rule : rules) {
        if (!rule.enabled) {
            continue;
        }
        const auto existing = runtimes_.find(rule.id);
        RuleRuntimePtr runtime;
        if (existing != runtimes_.end()) {
            runtime = existing->second;
            runtime->Update(rule);
        } else {
            runtime = std::make_shared<RuleRuntime>(rule);
        }
        next.emplace(rule.id, std::move(runtime));
    }
    runtimes_.swap(next);
}

RuleRuntimePtr ProxyServer::FindRuntime(const GUID& id)
{
    std::lock_guard lock(runtimeMutex_);
    const auto item = runtimes_.find(id);
    return item == runtimes_.end() ? nullptr : item->second;
}

void ProxyServer::RegisterSocket(SOCKET socket)
{
    std::lock_guard lock(connectionsMutex_);
    activeSockets_.insert(socket);
}

void ProxyServer::UnregisterSocket(SOCKET socket)
{
    std::lock_guard lock(connectionsMutex_);
    activeSockets_.erase(socket);
}

void ProxyServer::AcceptLoop(SOCKET listener)
{
    while (!stopping_.load(std::memory_order_relaxed)) {
        SOCKET client = accept(listener, nullptr, nullptr);
        if (client == INVALID_SOCKET) {
            if (stopping_.load(std::memory_order_relaxed)) {
                break;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            continue;
        }

        RegisterSocket(client);
        std::lock_guard lock(connectionsMutex_);
        connectionThreads_.emplace_back(&ProxyServer::HandleConnection, this, client);
    }
}

void ProxyServer::Relay(SOCKET source, SOCKET destination, TokenBucket& bucket)
{
    std::array<char, 32768> buffer{};
    while (!stopping_.load(std::memory_order_relaxed)) {
        const int received = recv(source, buffer.data(), static_cast<int>(buffer.size()), 0);
        if (received <= 0) {
            break;
        }
        if (!bucket.Acquire(static_cast<size_t>(received), stopping_) ||
            !SendAll(destination, buffer.data(), static_cast<size_t>(received))) {
            break;
        }
    }
    shutdown(destination, SD_SEND);
}

void ProxyServer::HandleConnection(SOCKET client)
{
    PULSENET_WFP_REDIRECT_CONTEXT context{};
    DWORD contextBytes = 0;
    const int contextResult = WSAIoctl(
        client,
        SIO_QUERY_WFP_CONNECTION_REDIRECT_CONTEXT,
        nullptr,
        0,
        &context,
        sizeof(context),
        &contextBytes,
        nullptr,
        nullptr);
    if (contextResult != 0 || contextBytes != sizeof(context) ||
        context.version != PULSENET_LIMITER_PROTOCOL_VERSION ||
        context.size != sizeof(context)) {
        UnregisterSocket(client);
        closesocket(client);
        return;
    }

    RuleRuntimePtr runtime = FindRuntime(context.ruleId);
    if (!runtime) {
        UnregisterSocket(client);
        closesocket(client);
        return;
    }

    const auto* remoteAddress = reinterpret_cast<const sockaddr_storage*>(context.originalRemote);
    if (remoteAddress->ss_family != AF_INET && remoteAddress->ss_family != AF_INET6) {
        UnregisterSocket(client);
        closesocket(client);
        return;
    }

    SOCKET remote = WSASocketW(remoteAddress->ss_family, SOCK_STREAM, IPPROTO_TCP, nullptr, 0, 0);
    if (remote == INVALID_SOCKET) {
        UnregisterSocket(client);
        closesocket(client);
        return;
    }
    RegisterSocket(remote);

    std::vector<unsigned char> redirectRecords;
    if (QueryRedirectRecords(client, &redirectRecords)) {
        ApplyRedirectRecords(remote, redirectRecords);
    }

    const int remoteLength = remoteAddress->ss_family == AF_INET
        ? sizeof(sockaddr_in)
        : sizeof(sockaddr_in6);
    if (connect(remote, reinterpret_cast<const sockaddr*>(remoteAddress), remoteLength) == SOCKET_ERROR) {
        UnregisterSocket(remote);
        UnregisterSocket(client);
        closesocket(remote);
        closesocket(client);
        return;
    }

    std::thread uploadThread([&] {
        Relay(client, remote, runtime->upload);
    });
    Relay(remote, client, runtime->download);
    uploadThread.join();

    shutdown(client, SD_BOTH);
    shutdown(remote, SD_BOTH);
    UnregisterSocket(remote);
    UnregisterSocket(client);
    closesocket(remote);
    closesocket(client);
}

void ProxyServer::Stop()
{
    if (!winsockStarted_) {
        return;
    }
    stopping_.store(true, std::memory_order_relaxed);

    if (listenerV4_ != INVALID_SOCKET) {
        closesocket(listenerV4_);
        listenerV4_ = INVALID_SOCKET;
    }
    if (listenerV6_ != INVALID_SOCKET) {
        closesocket(listenerV6_);
        listenerV6_ = INVALID_SOCKET;
    }
    if (acceptThreadV4_.joinable()) {
        acceptThreadV4_.join();
    }
    if (acceptThreadV6_.joinable()) {
        acceptThreadV6_.join();
    }

    {
        std::lock_guard lock(connectionsMutex_);
        for (const SOCKET socket : activeSockets_) {
            shutdown(socket, SD_BOTH);
        }
    }
    for (auto& thread : connectionThreads_) {
        if (thread.joinable()) {
            thread.join();
        }
    }
    connectionThreads_.clear();
    activeSockets_.clear();

    {
        std::lock_guard lock(runtimeMutex_);
        runtimes_.clear();
    }
    portV4_ = 0;
    portV6_ = 0;
    WSACleanup();
    winsockStarted_ = false;
}

