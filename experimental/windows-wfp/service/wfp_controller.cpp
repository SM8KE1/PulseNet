#include "wfp_controller.h"

#include <rpc.h>

namespace {

constexpr wchar_t kProviderName[] = L"PulseNet Bandwidth Limiter";
constexpr wchar_t kSubLayerName[] = L"PulseNet Bandwidth Rules";
constexpr wchar_t kCalloutV4Name[] = L"PulseNet TCP Connect Redirect IPv4";
constexpr wchar_t kCalloutV6Name[] = L"PulseNet TCP Connect Redirect IPv6";

GUID DeriveGuid(const GUID& source, uint32_t discriminator)
{
    GUID result = source;
    result.Data1 ^= 0xA5C30000u | discriminator;
    result.Data2 ^= static_cast<uint16_t>(discriminator * 0x101u);
    result.Data3 ^= static_cast<uint16_t>(0x5A00u | discriminator);
    result.Data4[0] ^= static_cast<unsigned char>(discriminator);
    result.Data4[7] ^= static_cast<unsigned char>(discriminator * 17u);
    return result;
}

DWORD AddCallout(
    HANDLE engine,
    const GUID& key,
    const GUID& layer,
    const wchar_t* name)
{
    FWPM_CALLOUT0 callout{};
    callout.calloutKey = key;
    callout.displayData.name = const_cast<wchar_t*>(name);
    callout.displayData.description = const_cast<wchar_t*>(name);
    callout.providerKey = const_cast<GUID*>(&PULSENET_WFP_PROVIDER_KEY);
    callout.applicableLayer = layer;
    const DWORD result = FwpmCalloutAdd0(engine, &callout, nullptr, nullptr);
    return result == FWP_E_ALREADY_EXISTS ? ERROR_SUCCESS : result;
}

} // namespace

WfpController::~WfpController()
{
    Shutdown();
}

DWORD WfpController::Initialize()
{
    if (engine_ != nullptr) {
        return ERROR_SUCCESS;
    }

    FWPM_SESSION0 session{};
    session.displayData.name = const_cast<wchar_t*>(kProviderName);
    session.displayData.description = const_cast<wchar_t*>(kProviderName);
    session.flags = FWPM_SESSION_FLAG_DYNAMIC;
    session.txnWaitTimeoutInMSec = 5000;

    DWORD result = FwpmEngineOpen0(
        nullptr,
        RPC_C_AUTHN_WINNT,
        nullptr,
        &session,
        &engine_);
    if (result != ERROR_SUCCESS) {
        engine_ = nullptr;
        return result;
    }

    result = AddBaseObjects();
    if (result != ERROR_SUCCESS) {
        Shutdown();
    }
    return result;
}

DWORD WfpController::AddBaseObjects()
{
    DWORD result = FwpmTransactionBegin0(engine_, 0);
    if (result != ERROR_SUCCESS) {
        return result;
    }

    FWPM_PROVIDER0 provider{};
    provider.providerKey = PULSENET_WFP_PROVIDER_KEY;
    provider.displayData.name = const_cast<wchar_t*>(kProviderName);
    provider.displayData.description = const_cast<wchar_t*>(kProviderName);
    result = FwpmProviderAdd0(engine_, &provider, nullptr);
    if (result != ERROR_SUCCESS && result != FWP_E_ALREADY_EXISTS) {
        FwpmTransactionAbort0(engine_);
        return result;
    }

    FWPM_SUBLAYER0 subLayer{};
    subLayer.subLayerKey = PULSENET_WFP_SUBLAYER_KEY;
    subLayer.displayData.name = const_cast<wchar_t*>(kSubLayerName);
    subLayer.displayData.description = const_cast<wchar_t*>(kSubLayerName);
    subLayer.providerKey = const_cast<GUID*>(&PULSENET_WFP_PROVIDER_KEY);
    subLayer.weight = 0x7000;
    result = FwpmSubLayerAdd0(engine_, &subLayer, nullptr);
    if (result != ERROR_SUCCESS && result != FWP_E_ALREADY_EXISTS) {
        FwpmTransactionAbort0(engine_);
        return result;
    }

    result = AddCallout(
        engine_,
        PULSENET_WFP_CALLOUT_V4_KEY,
        FWPM_LAYER_ALE_CONNECT_REDIRECT_V4,
        kCalloutV4Name);
    if (result == ERROR_SUCCESS) {
        result = AddCallout(
            engine_,
            PULSENET_WFP_CALLOUT_V6_KEY,
            FWPM_LAYER_ALE_CONNECT_REDIRECT_V6,
            kCalloutV6Name);
    }
    if (result != ERROR_SUCCESS) {
        FwpmTransactionAbort0(engine_);
        return result;
    }

    result = FwpmTransactionCommit0(engine_);
    return result;
}

DWORD WfpController::AddRule(
    const LimiterRule& rule,
    const FWP_BYTE_BLOB* appId,
    DWORD serviceProcessId,
    uint16_t proxyPortV4,
    uint16_t proxyPortV6,
    InstalledRuleKeys* keys)
{
    keys->providerContext = DeriveGuid(rule.id, 1);
    keys->filterV4 = DeriveGuid(rule.id, 2);
    keys->filterV6 = DeriveGuid(rule.id, 3);

    PULSENET_WFP_PROVIDER_CONTEXT contextData{};
    contextData.version = PULSENET_LIMITER_PROTOCOL_VERSION;
    contextData.size = sizeof(contextData);
    contextData.serviceProcessId = serviceProcessId;
    contextData.proxyPortV4 = proxyPortV4;
    contextData.proxyPortV6 = proxyPortV6;
    contextData.ruleId = rule.id;
    contextData.downloadLimitBps = rule.downloadLimitBps;
    contextData.uploadLimitBps = rule.uploadLimitBps;

    FWP_BYTE_BLOB contextBlob{};
    contextBlob.size = sizeof(contextData);
    contextBlob.data = reinterpret_cast<UINT8*>(&contextData);

    FWPM_PROVIDER_CONTEXT0 providerContext{};
    providerContext.providerContextKey = keys->providerContext;
    providerContext.displayData.name = const_cast<wchar_t*>(rule.processName.c_str());
    providerContext.providerKey = const_cast<GUID*>(&PULSENET_WFP_PROVIDER_KEY);
    providerContext.type = FWPM_GENERAL_CONTEXT;
    providerContext.dataBuffer = &contextBlob;

    DWORD result = FwpmProviderContextAdd0(engine_, &providerContext, nullptr, nullptr);
    if (result != ERROR_SUCCESS) {
        return result;
    }

    FWPM_FILTER_CONDITION0 conditions[2]{};
    conditions[0].fieldKey = FWPM_CONDITION_ALE_APP_ID;
    conditions[0].matchType = FWP_MATCH_EQUAL;
    conditions[0].conditionValue.type = FWP_BYTE_BLOB_TYPE;
    conditions[0].conditionValue.byteBlob = const_cast<FWP_BYTE_BLOB*>(appId);
    conditions[1].fieldKey = FWPM_CONDITION_IP_PROTOCOL;
    conditions[1].matchType = FWP_MATCH_EQUAL;
    conditions[1].conditionValue.type = FWP_UINT8;
    conditions[1].conditionValue.uint8 = IPPROTO_TCP;

    const auto addFilter = [&](const GUID& filterKey, const GUID& layerKey, const GUID& calloutKey) {
        FWPM_FILTER0 filter{};
        filter.filterKey = filterKey;
        filter.displayData.name = const_cast<wchar_t*>(rule.processName.c_str());
        filter.providerKey = const_cast<GUID*>(&PULSENET_WFP_PROVIDER_KEY);
        filter.layerKey = layerKey;
        filter.subLayerKey = PULSENET_WFP_SUBLAYER_KEY;
        filter.flags = FWPM_FILTER_FLAG_PERMIT_IF_CALLOUT_UNREGISTERED;
        filter.weight.type = FWP_EMPTY;
        filter.numFilterConditions = ARRAYSIZE(conditions);
        filter.filterCondition = conditions;
        filter.action.type = FWP_ACTION_CALLOUT_TERMINATING;
        filter.action.calloutKey = calloutKey;
        filter.providerContextKey = keys->providerContext;
        return FwpmFilterAdd0(engine_, &filter, nullptr, nullptr);
    };

    result = addFilter(
        keys->filterV4,
        FWPM_LAYER_ALE_CONNECT_REDIRECT_V4,
        PULSENET_WFP_CALLOUT_V4_KEY);
    if (result == ERROR_SUCCESS) {
        result = addFilter(
            keys->filterV6,
            FWPM_LAYER_ALE_CONNECT_REDIRECT_V6,
            PULSENET_WFP_CALLOUT_V6_KEY);
    }
    return result;
}

DWORD WfpController::ApplyRules(
    const std::vector<LimiterRule>& rules,
    DWORD serviceProcessId,
    uint16_t proxyPortV4,
    uint16_t proxyPortV6)
{
    if (engine_ == nullptr) {
        return ERROR_INVALID_HANDLE;
    }

    struct PreparedRule {
        const LimiterRule* rule = nullptr;
        FWP_BYTE_BLOB* appId = nullptr;
    };
    std::vector<PreparedRule> prepared;
    prepared.reserve(rules.size());

    DWORD result = ERROR_SUCCESS;
    for (const auto& rule : rules) {
        if (!rule.enabled) {
            continue;
        }
        FWP_BYTE_BLOB* appId = nullptr;
        result = FwpmGetAppIdFromFileName0(rule.executablePath.c_str(), &appId);
        if (result != ERROR_SUCCESS) {
            break;
        }
        prepared.push_back(PreparedRule{&rule, appId});
    }

    if (result == ERROR_SUCCESS) {
        result = FwpmTransactionBegin0(engine_, 0);
    }

    std::vector<InstalledRuleKeys> nextKeys;
    if (result == ERROR_SUCCESS) {
        for (const auto& keys : installedRules_) {
            FwpmFilterDeleteByKey0(engine_, &keys.filterV4);
            FwpmFilterDeleteByKey0(engine_, &keys.filterV6);
            FwpmProviderContextDeleteByKey0(engine_, &keys.providerContext);
        }

        nextKeys.reserve(prepared.size());
        for (const auto& item : prepared) {
            InstalledRuleKeys keys{};
            result = AddRule(
                *item.rule,
                item.appId,
                serviceProcessId,
                proxyPortV4,
                proxyPortV6,
                &keys);
            if (result != ERROR_SUCCESS) {
                break;
            }
            nextKeys.push_back(keys);
        }

        if (result == ERROR_SUCCESS) {
            result = FwpmTransactionCommit0(engine_);
            if (result == ERROR_SUCCESS) {
                installedRules_ = std::move(nextKeys);
            }
        } else {
            FwpmTransactionAbort0(engine_);
        }
    }

    for (auto& item : prepared) {
        if (item.appId != nullptr) {
            FwpmFreeMemory0(reinterpret_cast<void**>(&item.appId));
        }
    }
    return result;
}

void WfpController::Shutdown()
{
    installedRules_.clear();
    if (engine_ != nullptr) {
        FwpmEngineClose0(engine_);
        engine_ = nullptr;
    }
}

