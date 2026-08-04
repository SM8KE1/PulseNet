#include <ntddk.h>
#include <fwpsk.h>
#include <fwpmk.h>
#include <ws2def.h>
#include <ws2ipdef.h>
#include <mstcpip.h>

#include "..\shared\pulsenet_limiter.h"

#define PULSENET_POOL_TAG 'LNPu'

static PDEVICE_OBJECT g_deviceObject;
static HANDLE g_redirectHandle;
static UINT32 g_calloutIdV4;
static UINT32 g_calloutIdV6;

static NTSTATUS NTAPI PulseNetNotify(
    FWPS_CALLOUT_NOTIFY_TYPE notifyType,
    const GUID* filterKey,
    const FWPS_FILTER* filter)
{
    UNREFERENCED_PARAMETER(notifyType);
    UNREFERENCED_PARAMETER(filterKey);
    UNREFERENCED_PARAMETER(filter);
    return STATUS_SUCCESS;
}

static BOOLEAN PulseNetProviderContextIsValid(
    const FWPS_FILTER* filter,
    const PULSENET_WFP_PROVIDER_CONTEXT** config)
{
    const FWPM_PROVIDER_CONTEXT* providerContext;

    *config = NULL;
    if (filter == NULL || filter->providerContext == NULL) {
        return FALSE;
    }

    providerContext = filter->providerContext;
    if (providerContext->type != FWPM_GENERAL_CONTEXT ||
        providerContext->dataBuffer == NULL ||
        providerContext->dataBuffer->data == NULL ||
        providerContext->dataBuffer->size != sizeof(PULSENET_WFP_PROVIDER_CONTEXT)) {
        return FALSE;
    }

    *config = (const PULSENET_WFP_PROVIDER_CONTEXT*)providerContext->dataBuffer->data;
    return (*config)->version == PULSENET_LIMITER_PROTOCOL_VERSION &&
           (*config)->size == sizeof(PULSENET_WFP_PROVIDER_CONTEXT) &&
           (*config)->serviceProcessId != 0 &&
           (*config)->serviceProcessId <= MAXULONG;
}

static VOID NTAPI PulseNetClassify(
    const FWPS_INCOMING_VALUES* incomingValues,
    const FWPS_INCOMING_METADATA_VALUES* metadataValues,
    VOID* layerData,
    const VOID* classifyContext,
    const FWPS_FILTER* filter,
    UINT64 flowContext,
    FWPS_CLASSIFY_OUT* classifyOut)
{
    const PULSENET_WFP_PROVIDER_CONTEXT* config;
    PULSENET_WFP_REDIRECT_CONTEXT* redirectContext = NULL;
    FWPS_CONNECT_REQUEST* request = NULL;
    UINT64 classifyHandle = 0;
    UINT16 proxyPort;
    NTSTATUS status;

    UNREFERENCED_PARAMETER(flowContext);

    // Every failure path permits the original connection.
    if (classifyOut == NULL) {
        return;
    }
    classifyOut->actionType = FWP_ACTION_PERMIT;

    if ((classifyOut->rights & FWPS_RIGHT_ACTION_WRITE) == 0 ||
        incomingValues == NULL || metadataValues == NULL || layerData == NULL ||
        classifyContext == NULL || !PulseNetProviderContextIsValid(filter, &config)) {
        return;
    }

    if (incomingValues->layerId != FWPS_LAYER_ALE_CONNECT_REDIRECT_V4 &&
        incomingValues->layerId != FWPS_LAYER_ALE_CONNECT_REDIRECT_V6) {
        return;
    }

    if (FWPS_IS_METADATA_FIELD_PRESENT(metadataValues, FWPS_METADATA_FIELD_REDIRECT_RECORD_HANDLE)) {
        VOID* previousContext = NULL;
        FWPS_CONNECTION_REDIRECT_STATE redirectState = FwpsQueryConnectionRedirectState(
            metadataValues->redirectRecords,
            g_redirectHandle,
            &previousContext);
        if (redirectState == FWPS_CONNECTION_REDIRECTED_BY_SELF ||
            redirectState == FWPS_CONNECTION_PREVIOUSLY_REDIRECTED_BY_SELF) {
            return;
        }
    }

    proxyPort = incomingValues->layerId == FWPS_LAYER_ALE_CONNECT_REDIRECT_V4
        ? config->proxyPortV4
        : config->proxyPortV6;
    if (proxyPort == 0) {
        return;
    }

    status = FwpsAcquireClassifyHandle((VOID*)classifyContext, 0, &classifyHandle);
    if (!NT_SUCCESS(status)) {
        return;
    }

    status = FwpsAcquireWritableLayerDataPointer(
        classifyHandle,
        filter->filterId,
        0,
        (VOID**)&request,
        classifyOut);
    if (!NT_SUCCESS(status) || request == NULL) {
        FwpsReleaseClassifyHandle(classifyHandle);
        return;
    }

    redirectContext = (PULSENET_WFP_REDIRECT_CONTEXT*)ExAllocatePool2(
        POOL_FLAG_NON_PAGED,
        sizeof(PULSENET_WFP_REDIRECT_CONTEXT),
        PULSENET_POOL_TAG);
    if (redirectContext != NULL) {
        RtlZeroMemory(redirectContext, sizeof(*redirectContext));
        redirectContext->version = PULSENET_LIMITER_PROTOCOL_VERSION;
        redirectContext->size = sizeof(*redirectContext);
        redirectContext->ruleId = config->ruleId;
        RtlCopyMemory(redirectContext->originalRemote,
                      &request->remoteAddressAndPort,
                      sizeof(SOCKADDR_STORAGE));
        RtlCopyMemory(redirectContext->originalLocal,
                      &request->localAddressAndPort,
                      sizeof(SOCKADDR_STORAGE));

        request->localRedirectContext = redirectContext;
        request->localRedirectContextSize = sizeof(*redirectContext);
        request->localRedirectHandle = g_redirectHandle;
        request->localRedirectTargetPID = (UINT32)config->serviceProcessId;
        INETADDR_SETLOOPBACK((PSOCKADDR)&request->remoteAddressAndPort);
        INETADDR_SET_PORT((PSOCKADDR)&request->remoteAddressAndPort,
                          RtlUshortByteSwap(proxyPort));
    }

    classifyOut->actionType = FWP_ACTION_PERMIT;
    classifyOut->rights &= ~FWPS_RIGHT_ACTION_WRITE;
    FwpsApplyModifiedLayerData(
        classifyHandle,
        request,
        FWPS_CLASSIFY_FLAG_REAUTHORIZE_IF_MODIFIED_BY_OTHERS);
    FwpsReleaseClassifyHandle(classifyHandle);
}

static NTSTATUS PulseNetRegisterCallout(const GUID* key, UINT32* calloutId)
{
    FWPS_CALLOUT callout;
    RtlZeroMemory(&callout, sizeof(callout));
    callout.calloutKey = *key;
    callout.classifyFn = PulseNetClassify;
    callout.notifyFn = PulseNetNotify;
    return FwpsCalloutRegister(g_deviceObject, &callout, calloutId);
}

static VOID PulseNetUnload(PDRIVER_OBJECT driverObject)
{
    UNREFERENCED_PARAMETER(driverObject);

    if (g_calloutIdV6 != 0) {
        FwpsCalloutUnregisterById(g_calloutIdV6);
        g_calloutIdV6 = 0;
    }
    if (g_calloutIdV4 != 0) {
        FwpsCalloutUnregisterById(g_calloutIdV4);
        g_calloutIdV4 = 0;
    }
    if (g_redirectHandle != NULL) {
        FwpsRedirectHandleDestroy(g_redirectHandle);
        g_redirectHandle = NULL;
    }
    if (g_deviceObject != NULL) {
        IoDeleteDevice(g_deviceObject);
        g_deviceObject = NULL;
    }
}

NTSTATUS DriverEntry(PDRIVER_OBJECT driverObject, PUNICODE_STRING registryPath)
{
    NTSTATUS status;

    UNREFERENCED_PARAMETER(registryPath);
    driverObject->DriverUnload = PulseNetUnload;

    status = IoCreateDevice(
        driverObject,
        0,
        NULL,
        FILE_DEVICE_NETWORK,
        FILE_DEVICE_SECURE_OPEN,
        FALSE,
        &g_deviceObject);
    if (!NT_SUCCESS(status)) {
        return status;
    }
    g_deviceObject->Flags &= ~DO_DEVICE_INITIALIZING;

    status = FwpsRedirectHandleCreate(&PULSENET_WFP_PROVIDER_KEY, 0, &g_redirectHandle);
    if (!NT_SUCCESS(status)) {
        PulseNetUnload(driverObject);
        return status;
    }

    status = PulseNetRegisterCallout(&PULSENET_WFP_CALLOUT_V4_KEY, &g_calloutIdV4);
    if (!NT_SUCCESS(status)) {
        PulseNetUnload(driverObject);
        return status;
    }

    status = PulseNetRegisterCallout(&PULSENET_WFP_CALLOUT_V6_KEY, &g_calloutIdV6);
    if (!NT_SUCCESS(status)) {
        PulseNetUnload(driverObject);
        return status;
    }

    return STATUS_SUCCESS;
}
