#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "FenixRuntimeTypes.h"
#include "FenixRuntimeGameMode.generated.h"

class AFenixFirstPersonPawn;
class AFenixWorldBuilder;
class UFenixRuntimeBootstrapClient;
class UFenixRuntimeControlClient;

UCLASS()
class FENIX3D_API AFenixRuntimeGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    AFenixRuntimeGameMode();

protected:
    virtual void BeginPlay() override;

private:
    UPROPERTY()
    TObjectPtr<UFenixRuntimeBootstrapClient> BootstrapClient;

    UPROPERTY()
    TObjectPtr<UFenixRuntimeControlClient> ControlClient;

    UPROPERTY()
    TObjectPtr<AFenixWorldBuilder> WorldBuilder;

    UPROPERTY()
    TObjectPtr<AFenixFirstPersonPawn> ViewerPawn;

    FFenixRuntimeManifest CurrentManifest;
    bool bManifestReady = false;

    void HandleManifestReady(const FFenixRuntimeManifest& Manifest);
    void HandleManifestError(const FString& Error);
    void HandleStateSync(const FFenixRuntimeStateSync& Sync);
    void HandleControlError(const FString& Error);
    void HandleActionResult(const FString& Json);
    void HandleCollisionFeedback(const FString& WallId);

    void HandleMoveIntent(float Forward, float Strafe, bool bRun);
    void HandleLookIntent(float Yaw, float Pitch);
    void HandleActionIntent(const FString& Action);
    void BindPawn(AFenixFirstPersonPawn* Pawn);
};
