#pragma once

#include "CoreMinimal.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "UObject/Object.h"
#include "FenixRuntimeTypes.h"
#include "FenixRuntimeControlClient.generated.h"

DECLARE_MULTICAST_DELEGATE_OneParam(FFenixRuntimeStateSyncDelegate, const FFenixRuntimeStateSync&);
DECLARE_MULTICAST_DELEGATE_OneParam(FFenixRuntimeControlErrorDelegate, const FString&);
DECLARE_MULTICAST_DELEGATE_OneParam(FFenixRuntimeActionResultDelegate, const FString&);

UCLASS()
class FENIX3D_API UFenixRuntimeControlClient : public UObject
{
    GENERATED_BODY()

public:
    FFenixRuntimeStateSyncDelegate OnStateSync;
    FFenixRuntimeControlErrorDelegate OnControlError;
    FFenixRuntimeActionResultDelegate OnActionResult;

    void Start();
    bool IsConfigured() const;

    void SendMove(float Forward, float Strafe, bool bRun);
    void SendLook(float Yaw, float Pitch);
    void SendAction(const FString& Action, const FString& TargetId = FString());

private:
    FString ControlUrl;
    FString AccessToken;
    FString RenderSessionId;
    int64 NextSequence = 1;
    bool bRequestInFlight = false;
    TArray<FString> PendingBodies;

    void QueueIntent(const TSharedRef<class FJsonObject>& Intent);
    void PumpQueue();
    void HandleControlResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSucceeded);
    bool ParseStateSync(const TSharedPtr<class FJsonObject>& Result, FFenixRuntimeStateSync& OutSync) const;
};
