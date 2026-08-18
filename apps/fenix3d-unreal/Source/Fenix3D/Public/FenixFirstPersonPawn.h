#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "FenixRuntimeTypes.h"
#include "FenixFirstPersonPawn.generated.h"

class UCameraComponent;
class USceneComponent;

DECLARE_MULTICAST_DELEGATE_ThreeParams(FFenixMoveIntentDelegate, float, float, bool);
DECLARE_MULTICAST_DELEGATE_TwoParams(FFenixLookIntentDelegate, float, float);
DECLARE_MULTICAST_DELEGATE_OneParam(FFenixActionIntentDelegate, const FString&);

UCLASS()
class FENIX3D_API AFenixFirstPersonPawn : public APawn
{
    GENERATED_BODY()

public:
    AFenixFirstPersonPawn();

    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

    FFenixMoveIntentDelegate OnMoveIntent;
    FFenixLookIntentDelegate OnLookIntent;
    FFenixActionIntentDelegate OnActionIntent;

    void InitializeFromManifest(const FFenixRuntimeManifest& Manifest);
    void ApplyAuthoritativeState(const FFenixRuntimeStateSync& State, const FFenixRuntimeManifest& Manifest);

private:
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<USceneComponent> SceneRoot;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UCameraComponent> Camera;

    float ForwardInput = 0.0f;
    float StrafeInput = 0.0f;
    float LookYawInput = 0.0f;
    float LookPitchInput = 0.0f;
    float CurrentYaw = 0.0f;
    float CurrentPitch = 0.0f;
    float IntentAccumulator = 0.0f;
    bool bRunning = false;

    static constexpr float IntentIntervalSeconds = 0.05f;

    void MoveForward(float Value);
    void MoveRight(float Value);
    void LookYaw(float Value);
    void LookPitch(float Value);
    void RunPressed();
    void RunReleased();
    void PrimaryAction();
    void EmitInputIntents();
};
