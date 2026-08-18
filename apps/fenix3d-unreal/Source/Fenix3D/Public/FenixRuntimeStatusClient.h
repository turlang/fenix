#pragma once

#include "CoreMinimal.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "UObject/Object.h"
#include "FenixRuntimeTypes.h"
#include "FenixRuntimeStatusClient.generated.h"

DECLARE_MULTICAST_DELEGATE_OneParam(FFenixRuntimeStatusErrorDelegate, const FString&);

UCLASS()
class FENIX3D_API UFenixRuntimeStatusClient : public UObject
{
    GENERATED_BODY()

public:
    FFenixRuntimeStatusErrorDelegate OnStatusError;

    void Start();
    bool IsConfigured() const;
    void ReportBooting();
    void ReportManifestReady(const FFenixRuntimeManifest& Manifest);
    void ReportReady(const FFenixRuntimeManifest& Manifest, bool bWorldBuilt, bool bControlConfigured);
    void ReportFailure(const FString& Message);

private:
    FString StatusUrl;
    FString AccessToken;
    FString RenderSessionId;
    FString CampaignId;
    FString SceneId;
    FString ActorId;
    FString TokenId;

    void Report(const FString& Stage, const FFenixRuntimeManifest* Manifest, bool bWorldBuilt, bool bControlConfigured, const FString& Message = FString());
    void HandleReportResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSucceeded);
};
