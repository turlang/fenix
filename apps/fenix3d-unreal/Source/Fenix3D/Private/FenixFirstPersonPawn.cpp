#include "FenixFirstPersonPawn.h"

#include "Camera/CameraComponent.h"
#include "Components/InputComponent.h"
#include "Components/SceneComponent.h"

AFenixFirstPersonPawn::AFenixFirstPersonPawn()
{
    PrimaryActorTick.bCanEverTick = true;
    AutoPossessPlayer = EAutoReceiveInput::Player0;
    SetActorEnableCollision(false);

    SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
    RootComponent = SceneRoot;

    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("FirstPersonCamera"));
    Camera->SetupAttachment(SceneRoot);
    Camera->bUsePawnControlRotation = false;
}

void AFenixFirstPersonPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    check(PlayerInputComponent);

    PlayerInputComponent->BindAxis(TEXT("MoveForward"), this, &AFenixFirstPersonPawn::MoveForward);
    PlayerInputComponent->BindAxis(TEXT("MoveRight"), this, &AFenixFirstPersonPawn::MoveRight);
    PlayerInputComponent->BindAxis(TEXT("LookYaw"), this, &AFenixFirstPersonPawn::LookYaw);
    PlayerInputComponent->BindAxis(TEXT("LookPitch"), this, &AFenixFirstPersonPawn::LookPitch);
    PlayerInputComponent->BindAction(TEXT("Run"), IE_Pressed, this, &AFenixFirstPersonPawn::RunPressed);
    PlayerInputComponent->BindAction(TEXT("Run"), IE_Released, this, &AFenixFirstPersonPawn::RunReleased);
    PlayerInputComponent->BindAction(TEXT("PrimaryAction"), IE_Pressed, this, &AFenixFirstPersonPawn::PrimaryAction);
}

void AFenixFirstPersonPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    ReconcileAuthoritativeTransform(DeltaSeconds);

    IntentAccumulator += DeltaSeconds;
    if (IntentAccumulator >= IntentIntervalSeconds)
    {
        IntentAccumulator = FMath::Fmod(IntentAccumulator, IntentIntervalSeconds);
        EmitInputIntents();
    }
}

void AFenixFirstPersonPawn::InitializeFromManifest(const FFenixRuntimeManifest& Manifest)
{
    const FFenixRuntimeCamera& RuntimeCamera = Manifest.Viewer.Camera;
    CurrentYaw = static_cast<float>(RuntimeCamera.SceneRotationDegrees);
    CurrentPitch = static_cast<float>(RuntimeCamera.PitchDegrees);

    const FVector PawnLocation = RuntimeCamera.Location - FVector(0.0, 0.0, RuntimeCamera.EyeHeightCm);
    SetActorLocationAndRotation(PawnLocation, FRotator(0.0, CurrentYaw, 0.0), false, nullptr, ETeleportType::TeleportPhysics);
    AuthoritativeTargetLocation = PawnLocation;
    AuthoritativeTargetRotation = FRotator(0.0, CurrentYaw, 0.0);
    bHasAuthoritativeTarget = true;

    Camera->SetRelativeLocation(FVector(0.0, 0.0, RuntimeCamera.EyeHeightCm));
    Camera->SetRelativeRotation(FRotator(CurrentPitch, 0.0, 0.0));
    Camera->SetFieldOfView(FMath::Clamp(static_cast<float>(RuntimeCamera.FovDegrees), 60.0f, 120.0f));
}

void AFenixFirstPersonPawn::ApplyAuthoritativeState(const FFenixRuntimeStateSync& State, const FFenixRuntimeManifest& Manifest)
{
    const double CmPerPixel = FMath::Max(0.0001, Manifest.Scene.CentimetersPerPixel);
    const double ElevationCm = State.Elevation * (Manifest.Scene.SceneUnit == TEXT("ft") ? 30.48 : 100.0);
    AuthoritativeTargetLocation = FVector(
        State.ScenePosition.X * CmPerPixel,
        -State.ScenePosition.Y * CmPerPixel,
        ElevationCm
    );
    AuthoritativeTargetRotation = FRotator(0.0, State.Rotation, 0.0);
    bHasAuthoritativeTarget = true;

    if (State.bCollisionBlocked)
    {
        OnCollisionFeedback.Broadcast(State.CollisionWallId);
    }
}

void AFenixFirstPersonPawn::ReconcileAuthoritativeTransform(float DeltaSeconds)
{
    if (!bHasAuthoritativeTarget) return;

    const FVector CurrentLocation = GetActorLocation();
    const FVector NextLocation = FMath::VInterpTo(CurrentLocation, AuthoritativeTargetLocation, DeltaSeconds, ReconciliationSpeed);
    const FRotator CurrentRotation = GetActorRotation();
    const FRotator NextRotation = FMath::RInterpTo(CurrentRotation, AuthoritativeTargetRotation, DeltaSeconds, ReconciliationSpeed);
    SetActorLocationAndRotation(NextLocation, NextRotation, false, nullptr, ETeleportType::None);

    if (FVector::DistSquared(NextLocation, AuthoritativeTargetLocation) < 0.25)
    {
        SetActorLocation(AuthoritativeTargetLocation, false, nullptr, ETeleportType::None);
    }
}

void AFenixFirstPersonPawn::MoveForward(float Value)
{
    ForwardInput = FMath::Clamp(Value, -1.0f, 1.0f);
}

void AFenixFirstPersonPawn::MoveRight(float Value)
{
    StrafeInput = FMath::Clamp(Value, -1.0f, 1.0f);
}

void AFenixFirstPersonPawn::LookYaw(float Value)
{
    LookYawInput += Value;
}

void AFenixFirstPersonPawn::LookPitch(float Value)
{
    LookPitchInput += Value;
}

void AFenixFirstPersonPawn::RunPressed()
{
    bRunning = true;
}

void AFenixFirstPersonPawn::RunReleased()
{
    bRunning = false;
}

void AFenixFirstPersonPawn::PrimaryAction()
{
    OnActionIntent.Broadcast(TEXT("interact"));
}

void AFenixFirstPersonPawn::EmitInputIntents()
{
    if (!FMath::IsNearlyZero(ForwardInput) || !FMath::IsNearlyZero(StrafeInput))
    {
        OnMoveIntent.Broadcast(ForwardInput, StrafeInput, bRunning);
    }

    if (!FMath::IsNearlyZero(LookYawInput) || !FMath::IsNearlyZero(LookPitchInput))
    {
        CurrentYaw = FMath::Fmod(CurrentYaw + LookYawInput + 360.0f, 360.0f);
        CurrentPitch = FMath::Clamp(CurrentPitch + LookPitchInput, -89.0f, 89.0f);
        SetActorRotation(FRotator(0.0, CurrentYaw, 0.0));
        Camera->SetRelativeRotation(FRotator(CurrentPitch, 0.0, 0.0));
        OnLookIntent.Broadcast(CurrentYaw, CurrentPitch);
    }

    LookYawInput = 0.0f;
    LookPitchInput = 0.0f;
}
