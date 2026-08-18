#include "FenixRuntimeGameMode.h"

#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "FenixFirstPersonPawn.h"
#include "FenixRuntimeBootstrapClient.h"
#include "FenixRuntimeControlClient.h"
#include "FenixRuntimeStatusClient.h"
#include "FenixWorldBuilder.h"

AFenixRuntimeGameMode::AFenixRuntimeGameMode()
{
    DefaultPawnClass = AFenixFirstPersonPawn::StaticClass();
}

void AFenixRuntimeGameMode::BeginPlay()
{
    Super::BeginPlay();

    StatusClient = NewObject<UFenixRuntimeStatusClient>(this);
    BootstrapClient = NewObject<UFenixRuntimeBootstrapClient>(this);
    ControlClient = NewObject<UFenixRuntimeControlClient>(this);

    StatusClient->OnStatusError.AddUObject(this, &AFenixRuntimeGameMode::HandleStatusError);
    BootstrapClient->OnManifestReady.AddUObject(this, &AFenixRuntimeGameMode::HandleManifestReady);
    BootstrapClient->OnManifestError.AddUObject(this, &AFenixRuntimeGameMode::HandleManifestError);
    ControlClient->OnStateSync.AddUObject(this, &AFenixRuntimeGameMode::HandleStateSync);
    ControlClient->OnControlError.AddUObject(this, &AFenixRuntimeGameMode::HandleControlError);
    ControlClient->OnActionResult.AddUObject(this, &AFenixRuntimeGameMode::HandleActionResult);

    StatusClient->Start();
    StatusClient->ReportBooting();
    ControlClient->Start();
    BootstrapClient->Start();
}

void AFenixRuntimeGameMode::HandleManifestReady(const FFenixRuntimeManifest& Manifest)
{
    CurrentManifest = Manifest;
    bManifestReady = true;
    if (StatusClient) StatusClient->ReportManifestReady(CurrentManifest);

    if (!WorldBuilder && GetWorld())
    {
        WorldBuilder = GetWorld()->SpawnActor<AFenixWorldBuilder>();
    }
    if (WorldBuilder) WorldBuilder->BuildWorld(CurrentManifest);

    ViewerPawn = Cast<AFenixFirstPersonPawn>(UGameplayStatics::GetPlayerPawn(this, 0));
    if (!ViewerPawn && GetWorld())
    {
        ViewerPawn = GetWorld()->SpawnActor<AFenixFirstPersonPawn>();
        if (APlayerController* Controller = UGameplayStatics::GetPlayerController(this, 0))
        {
            Controller->Possess(ViewerPawn);
        }
    }

    if (ViewerPawn)
    {
        ViewerPawn->InitializeFromManifest(CurrentManifest);
        BindPawn(ViewerPawn);
    }

    const bool bWorldBuilt = WorldBuilder != nullptr && ViewerPawn != nullptr;
    const bool bControlConfigured = ControlClient != nullptr && ControlClient->IsConfigured();
    if (StatusClient) StatusClient->ReportReady(CurrentManifest, bWorldBuilt, bControlConfigured);

    UE_LOG(LogTemp, Display, TEXT("[Fenix3D] Runtime ready: campaign=%s scene=%s token=%s walls=%d entities=%d control=%s"),
        *CurrentManifest.CampaignId,
        *CurrentManifest.Scene.Id,
        *CurrentManifest.Viewer.TokenId,
        CurrentManifest.Walls.Num(),
        CurrentManifest.Entities.Num(),
        bControlConfigured ? TEXT("ready") : TEXT("missing"));
}

void AFenixRuntimeGameMode::BindPawn(AFenixFirstPersonPawn* Pawn)
{
    if (!Pawn) return;

    Pawn->OnMoveIntent.RemoveAll(this);
    Pawn->OnLookIntent.RemoveAll(this);
    Pawn->OnActionIntent.RemoveAll(this);
    Pawn->OnCollisionFeedback.RemoveAll(this);
    Pawn->OnMoveIntent.AddUObject(this, &AFenixRuntimeGameMode::HandleMoveIntent);
    Pawn->OnLookIntent.AddUObject(this, &AFenixRuntimeGameMode::HandleLookIntent);
    Pawn->OnActionIntent.AddUObject(this, &AFenixRuntimeGameMode::HandleActionIntent);
    Pawn->OnCollisionFeedback.AddUObject(this, &AFenixRuntimeGameMode::HandleCollisionFeedback);
}

void AFenixRuntimeGameMode::HandleManifestError(const FString& Error)
{
    if (StatusClient) StatusClient->ReportFailure(Error);
    UE_LOG(LogTemp, Error, TEXT("[Fenix3D] Manifest bootstrap failed: %s"), *Error);
}

void AFenixRuntimeGameMode::HandleStateSync(const FFenixRuntimeStateSync& Sync)
{
    if (!bManifestReady || !ViewerPawn) return;
    if (Sync.TokenId != CurrentManifest.Viewer.TokenId || Sync.ActorId != CurrentManifest.Viewer.ActorId)
    {
        UE_LOG(LogTemp, Warning, TEXT("[Fenix3D] Ignored state sync for another actor/token."));
        return;
    }

    ViewerPawn->ApplyAuthoritativeState(Sync, CurrentManifest);
    if (WorldBuilder) WorldBuilder->ApplySceneSync(Sync, CurrentManifest);
}

void AFenixRuntimeGameMode::HandleControlError(const FString& Error)
{
    UE_LOG(LogTemp, Warning, TEXT("[Fenix3D] Runtime control: %s"), *Error);
}

void AFenixRuntimeGameMode::HandleStatusError(const FString& Error)
{
    UE_LOG(LogTemp, Warning, TEXT("[Fenix3D] Runtime evidence: %s"), *Error);
}

void AFenixRuntimeGameMode::HandleActionResult(const FString& Json)
{
    UE_LOG(LogTemp, Verbose, TEXT("[Fenix3D] Action result received (%d chars)."), Json.Len());
}

void AFenixRuntimeGameMode::HandleCollisionFeedback(const FString& WallId)
{
    const FString Message = WallId.IsEmpty()
        ? TEXT("Movimento bloqueado pelo Fênix Core")
        : FString::Printf(TEXT("Movimento bloqueado: %s"), *WallId);
    UE_LOG(LogTemp, Display, TEXT("[Fenix3D] %s"), *Message);
    if (GEngine)
    {
        GEngine->AddOnScreenDebugMessage(77, 0.35f, FColor::Orange, Message);
    }
}

void AFenixRuntimeGameMode::HandleMoveIntent(float Forward, float Strafe, bool bRun)
{
    if (ControlClient) ControlClient->SendMove(Forward, Strafe, bRun);
}

void AFenixRuntimeGameMode::HandleLookIntent(float Yaw, float Pitch)
{
    if (ControlClient) ControlClient->SendLook(Yaw, Pitch);
}

void AFenixRuntimeGameMode::HandleActionIntent(const FString& Action)
{
    if (ControlClient) ControlClient->SendAction(Action);
}
