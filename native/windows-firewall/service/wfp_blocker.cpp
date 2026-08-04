#include "wfp_blocker.h"

#include <fwpmu.h>
#include <rpc.h>

namespace {

constexpr wchar_t kSessionName[] = L"PulseNet Network Control";
constexpr wchar_t kSubLayerName[] = L"PulseNet Application Blocking";

const GUID kPulseNetBlockSubLayer =
    {0xb754f8a3, 0x8ced, 0x4a85, {0x9a, 0x55, 0x58, 0xd9, 0x29, 0x98, 0x56, 0x6f}};

DWORD AddBlockFilter(
    HANDLE engine,
    const GUID& layer,
    const WfpApplicationRule& rule,
    const FWP_BYTE_BLOB* appId,
    UINT64* filterId)
{
    FWPM_FILTER_CONDITION0 condition{};
    condition.fieldKey = FWPM_CONDITION_ALE_APP_ID;
    condition.matchType = FWP_MATCH_EQUAL;
    condition.conditionValue.type = FWP_BYTE_BLOB_TYPE;
    condition.conditionValue.byteBlob = const_cast<FWP_BYTE_BLOB*>(appId);

    FWPM_FILTER0 filter{};
    filter.displayData.name = const_cast<wchar_t*>(rule.name.c_str());
    filter.displayData.description = const_cast<wchar_t*>(L"Blocks network access for this PulseNet application rule.");
    filter.layerKey = layer;
    filter.subLayerKey = kPulseNetBlockSubLayer;
    filter.flags = FWPM_FILTER_FLAG_CLEAR_ACTION_RIGHT;
    filter.weight.type = FWP_EMPTY;
    filter.numFilterConditions = 1;
    filter.filterCondition = &condition;
    filter.action.type = FWP_ACTION_BLOCK;
    return FwpmFilterAdd0(engine, &filter, nullptr, filterId);
}

} // namespace

WfpBlocker::~WfpBlocker()
{
    Shutdown();
}

DWORD WfpBlocker::Initialize()
{
    if (engine_ != nullptr) {
        return ERROR_SUCCESS;
    }

    FWPM_SESSION0 session{};
    session.displayData.name = const_cast<wchar_t*>(kSessionName);
    session.displayData.description = const_cast<wchar_t*>(kSessionName);
    session.flags = FWPM_SESSION_FLAG_DYNAMIC;
    session.txnWaitTimeoutInMSec = 5000;

    DWORD result = FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, &session, &engine_);
    if (result != ERROR_SUCCESS) {
        engine_ = nullptr;
        return result;
    }

    FWPM_SUBLAYER0 subLayer{};
    subLayer.subLayerKey = kPulseNetBlockSubLayer;
    subLayer.displayData.name = const_cast<wchar_t*>(kSubLayerName);
    subLayer.displayData.description = const_cast<wchar_t*>(kSubLayerName);
    subLayer.weight = 0x7F00;
    result = FwpmSubLayerAdd0(engine_, &subLayer, nullptr);
    if (result != ERROR_SUCCESS && result != FWP_E_ALREADY_EXISTS) {
        Shutdown();
        return result;
    }
    return ERROR_SUCCESS;
}

DWORD WfpBlocker::ReplaceRules(const std::vector<WfpApplicationRule>& rules)
{
    DWORD result = Initialize();
    if (result != ERROR_SUCCESS) {
        return result;
    }

    struct PreparedRule {
        const WfpApplicationRule* rule = nullptr;
        FWP_BYTE_BLOB* appId = nullptr;
    };
    std::vector<PreparedRule> prepared;
    prepared.reserve(rules.size());
    for (const auto& rule : rules) {
        FWP_BYTE_BLOB* appId = nullptr;
        result = FwpmGetAppIdFromFileName0(rule.path.c_str(), &appId);
        if (result != ERROR_SUCCESS) {
            break;
        }
        prepared.push_back(PreparedRule{&rule, appId});
    }

    if (result == ERROR_SUCCESS) {
        result = FwpmTransactionBegin0(engine_, 0);
    }

    std::vector<UINT64> nextFilterIds;
    if (result == ERROR_SUCCESS) {
        for (const UINT64 filterId : filterIds_) {
            result = FwpmFilterDeleteById0(engine_, filterId);
            if (result != ERROR_SUCCESS && result != FWP_E_FILTER_NOT_FOUND) {
                break;
            }
            result = ERROR_SUCCESS;
        }
    }

    const GUID* layers[] = {
        &FWPM_LAYER_ALE_AUTH_CONNECT_V4,
        &FWPM_LAYER_ALE_AUTH_CONNECT_V6,
        &FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4,
        &FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6,
    };
    if (result == ERROR_SUCCESS) {
        nextFilterIds.reserve(prepared.size() * ARRAYSIZE(layers));
        for (const auto& item : prepared) {
            for (const auto* layer : layers) {
                UINT64 filterId = 0;
                result = AddBlockFilter(engine_, *layer, *item.rule, item.appId, &filterId);
                if (result != ERROR_SUCCESS) {
                    break;
                }
                nextFilterIds.push_back(filterId);
            }
            if (result != ERROR_SUCCESS) {
                break;
            }
        }
    }

    if (result == ERROR_SUCCESS) {
        result = FwpmTransactionCommit0(engine_);
        if (result == ERROR_SUCCESS) {
            filterIds_ = std::move(nextFilterIds);
        }
    } else {
        FwpmTransactionAbort0(engine_);
    }

    for (auto& item : prepared) {
        FwpmFreeMemory0(reinterpret_cast<void**>(&item.appId));
    }
    return result;
}

void WfpBlocker::Shutdown()
{
    filterIds_.clear();
    if (engine_ != nullptr) {
        FwpmEngineClose0(engine_);
        engine_ = nullptr;
    }
}
