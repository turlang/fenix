#pragma once

#include "CoreMinimal.h"

struct FFenixRuntimeWall
{
    FString Id;
    FString Kind;
    FString DoorState;
    bool bBlocksMovement = true;
    bool bBlocksVision = true;
    FVector A = FVector::ZeroVector;
    FVector B = FVector::ZeroVector;
    double BottomZ = 0.0;
    double TopZ = 300.0;
    double HeightCm = 300.0;
    double RecommendedThicknessCm = 10.0;
};

struct FFenixRuntimeRegion
{
    FString Id;
    FString Name;
    FString Kind;
    bool bEnabled = true;
    int32 Priority = 0;
    double BaseZ = 0.0;
    double TargetZ = 0.0;
    TArray<FVector> Points;
    FVector AxisStart = FVector::ZeroVector;
    FVector AxisEnd = FVector::ZeroVector;
    bool bHasAxis = false;
};

struct FFenixRuntimeLevel
{
    FString Id;
    FString Name;
    double ElevationCm = 0.0;
};

struct FFenixRuntimeLight
{
    FString Id;
    FString Name;
    bool bEnabled = true;
    FString ColorHex = TEXT("#f2c66f");
    double Intensity = 1.0;
    double RadiusCm = 600.0;
    FString AttachedTokenId;
    FVector Location = FVector::ZeroVector;
};

struct FFenixRuntimeEntity
{
    FString TokenId;
    FString ActorId;
    FString SheetId;
    FString SystemId;
    FString Name;
    FString Kind;
    FString Image;
    bool bViewer = false;
    bool bVisible = true;
    FVector Location = FVector::ZeroVector;
    double SceneRotationDegrees = 0.0;
    double FootprintCm = 150.0;
    double HeightCm = 180.0;
    FString MovementMode = TEXT("ground");
};

struct FFenixRuntimeCamera
{
    FVector Location = FVector::ZeroVector;
    double SceneRotationDegrees = 0.0;
    double PitchDegrees = 0.0;
    double FovDegrees = 90.0;
    double EyeHeightCm = 160.0;
    FString PreferredSense = TEXT("normal");
    double VisionDistanceCm = 0.0;
};

struct FFenixRuntimeScene
{
    FString Id;
    FString Name;
    double WidthCm = 1.0;
    double HeightCm = 1.0;
    double CentimetersPerPixel = 1.0;
    FString SceneUnit = TEXT("m");
    FString BackgroundAssetId;
    double Darkness = 0.0;
    bool bLightingEnabled = false;
};

struct FFenixRuntimeViewer
{
    FString ActorId;
    FString TokenId;
    FString SheetId;
    FString SystemId;
    FFenixRuntimeCamera Camera;
};

struct FFenixRuntimeManifest
{
    FString Schema;
    int32 Version = 0;
    FString CreatedAt;
    FString CampaignId;
    FString CampaignTitle;
    FString CampaignSystemId;
    FFenixRuntimeScene Scene;
    TArray<FFenixRuntimeWall> Walls;
    TArray<FFenixRuntimeRegion> Regions;
    TArray<FFenixRuntimeLevel> Levels;
    TArray<FFenixRuntimeLight> Lights;
    TArray<FFenixRuntimeEntity> Entities;
    FFenixRuntimeViewer Viewer;
    bool bFogEnabled = false;
    TArray<FString> ExploredCells;

    bool IsCompatible() const
    {
        return Schema == TEXT("fenix.3d-runtime-manifest") && Version == 1 && !Viewer.TokenId.IsEmpty();
    }
};

struct FFenixRuntimeEntityState
{
    FString TokenId;
    FString ActorId;
    FVector ScenePosition = FVector::ZeroVector;
    double Elevation = 0.0;
    double Rotation = 0.0;
    bool bVisible = true;
    FString MovementMode = TEXT("ground");
};

struct FFenixRuntimeStateSync
{
    FString RenderSessionId;
    int64 Revision = 0;
    FString TokenId;
    FString ActorId;
    FVector ScenePosition = FVector::ZeroVector;
    double Elevation = 0.0;
    double Rotation = 0.0;
    FString MovementMode = TEXT("ground");
    bool bCollisionBlocked = false;
    FString CollisionWallId;
    TArray<FFenixRuntimeEntityState> Entities;
};
