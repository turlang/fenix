#pragma once

#include "CoreMinimal.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "UObject/Object.h"
#include "FenixRuntimeTypes.h"
#include "FenixRuntimeBootstrapClient.generated.h"

DECLARE_MULTICAST_DELEGATE_OneParam(FFenixManifestReady, const FFenixRuntimeManifest&);
DECLARE_MULTICAST_DELEGATE_OneParam(FFenixManifestError, const FString&);

UCLASS()
class FENIX3D_API UFenixRuntimeBootstrapClient : public UObject
{
    GENERATED_BODY()

public:
    FFenixManifestReady OnManifestReady;
    FFenixManifestError OnManifestError;

    void Start();
    void FetchManifest(const FString& Url, const FString& AccessToken);

    static bool ParseManifestJson(const FString& Json, FFenixRuntimeManifest& OutManifest, FString& OutError);

private:
    void HandleManifestResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSucceeded);
};
