#include "FenixWorldBuilder.h"

#include "Components/PointLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/PointLight.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"

AFenixWorldBuilder::AFenixWorldBuilder()
{
    PrimaryActorTick.bCanEverTick = false;
    CubeMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    CylinderMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
}

void AFenixWorldBuilder::ClearWorld()
{
    for (AActor* Actor : RuntimeActors)
    {
        if (IsValid(Actor)) Actor->Destroy();
    }
    RuntimeActors.Reset();
}

void AFenixWorldBuilder::BuildWorld(const FFenixRuntimeManifest& Manifest)
{
    ClearWorld();
    BuildBaseFloor(Manifest);
    BuildRegions(Manifest);
    BuildWalls(Manifest);
    BuildLights(Manifest);
    BuildEntities(Manifest);
}

AActor* AFenixWorldBuilder::SpawnBox(const FString& Label, const FVector& Location, const FVector& SizeCm, const FRotator& Rotation)
{
    if (!GetWorld() || !CubeMesh) return nullptr;

    AStaticMeshActor* Actor = GetWorld()->SpawnActor<AStaticMeshActor>(Location, Rotation);
    if (!Actor) return nullptr;

    UStaticMeshComponent* Mesh = Actor->GetStaticMeshComponent();
    Mesh->SetStaticMesh(CubeMesh);
    Mesh->SetMobility(EComponentMobility::Movable);
    Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Mesh->SetGenerateOverlapEvents(false);
    Actor->SetActorScale3D(FVector(
        FMath::Max(1.0, SizeCm.X) / 100.0,
        FMath::Max(1.0, SizeCm.Y) / 100.0,
        FMath::Max(1.0, SizeCm.Z) / 100.0
    ));
    Actor->Tags.Add(*Label);
    RuntimeActors.Add(Actor);
    return Actor;
}

void AFenixWorldBuilder::BuildBaseFloor(const FFenixRuntimeManifest& Manifest)
{
    const double Width = FMath::Max(100.0, Manifest.Scene.WidthCm);
    const double Height = FMath::Max(100.0, Manifest.Scene.HeightCm);
    SpawnBox(
        TEXT("Fenix.BaseFloor"),
        FVector(Width * 0.5, -Height * 0.5, -5.0),
        FVector(Width, Height, 10.0)
    );
}

void AFenixWorldBuilder::BuildWalls(const FFenixRuntimeManifest& Manifest)
{
    for (const FFenixRuntimeWall& Wall : Manifest.Walls)
    {
        const FVector Delta = Wall.B - Wall.A;
        const double Length = FMath::Max(1.0, FVector2D(Delta.X, Delta.Y).Size());
        const double Height = FMath::Max(1.0, Wall.HeightCm);
        const double Thickness = FMath::Clamp(Wall.RecommendedThicknessCm, 2.0, 50.0);
        const FVector Midpoint(
            (Wall.A.X + Wall.B.X) * 0.5,
            (Wall.A.Y + Wall.B.Y) * 0.5,
            Wall.BottomZ + Height * 0.5
        );
        const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Delta.Y, Delta.X));
        const FString Tag = Wall.Kind == TEXT("door")
            ? FString::Printf(TEXT("Fenix.Door.%s.%s"), *Wall.Id, *Wall.DoorState)
            : FString::Printf(TEXT("Fenix.Wall.%s"), *Wall.Id);

        SpawnBox(Tag, Midpoint, FVector(Length, Thickness, Height), FRotator(0.0, Yaw, 0.0));
    }
}

void AFenixWorldBuilder::BuildRegions(const FFenixRuntimeManifest& Manifest)
{
    for (const FFenixRuntimeRegion& Region : Manifest.Regions)
    {
        if (!Region.bEnabled || Region.Points.Num() < 3) continue;

        FVector Min = Region.Points[0];
        FVector Max = Region.Points[0];
        for (const FVector& Point : Region.Points)
        {
            Min.X = FMath::Min(Min.X, Point.X);
            Min.Y = FMath::Min(Min.Y, Point.Y);
            Max.X = FMath::Max(Max.X, Point.X);
            Max.Y = FMath::Max(Max.Y, Point.Y);
        }

        const double MidZ = (Region.BaseZ + Region.TargetZ) * 0.5;
        const FVector Size(FMath::Max(10.0, Max.X - Min.X), FMath::Max(10.0, Max.Y - Min.Y), 8.0);
        const FVector Center((Min.X + Max.X) * 0.5, (Min.Y + Max.Y) * 0.5, MidZ - 4.0);
        FRotator Rotation = FRotator::ZeroRotator;

        if (Region.bHasAxis && Region.Kind == TEXT("ramp"))
        {
            const FVector Axis = Region.AxisEnd - Region.AxisStart;
            const double Horizontal = FMath::Max(1.0, FVector2D(Axis.X, Axis.Y).Size());
            const double Pitch = -FMath::RadiansToDegrees(FMath::Atan2(Region.TargetZ - Region.BaseZ, Horizontal));
            const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Axis.Y, Axis.X));
            Rotation = FRotator(Pitch, Yaw, 0.0);
        }

        SpawnBox(FString::Printf(TEXT("Fenix.Region.%s.%s"), *Region.Kind, *Region.Id), Center, Size, Rotation);
    }
}

void AFenixWorldBuilder::BuildLights(const FFenixRuntimeManifest& Manifest)
{
    if (!Manifest.Scene.bLightingEnabled || !GetWorld()) return;

    for (const FFenixRuntimeLight& Light : Manifest.Lights)
    {
        if (!Light.bEnabled) continue;
        APointLight* Actor = GetWorld()->SpawnActor<APointLight>(Light.Location, FRotator::ZeroRotator);
        if (!Actor) continue;

        UPointLightComponent* Component = Actor->PointLightComponent;
        Component->SetMobility(EComponentMobility::Movable);
        Component->SetAttenuationRadius(FMath::Max(50.0, Light.RadiusCm));
        Component->SetIntensity(FMath::Clamp(Light.Intensity, 0.0, 1.0) * 5000.0);
        Component->SetLightColor(FLinearColor::FromSRGBColor(FColor::FromHex(Light.ColorHex)));
        Actor->Tags.Add(*FString::Printf(TEXT("Fenix.Light.%s"), *Light.Id));
        RuntimeActors.Add(Actor);
    }
}

void AFenixWorldBuilder::BuildEntities(const FFenixRuntimeManifest& Manifest)
{
    if (!GetWorld() || !CylinderMesh) return;

    for (const FFenixRuntimeEntity& Entity : Manifest.Entities)
    {
        if (!Entity.bVisible || Entity.bViewer) continue;
        AStaticMeshActor* Actor = GetWorld()->SpawnActor<AStaticMeshActor>(Entity.Location, FRotator(0.0, Entity.SceneRotationDegrees, 0.0));
        if (!Actor) continue;

        UStaticMeshComponent* Mesh = Actor->GetStaticMeshComponent();
        Mesh->SetStaticMesh(CylinderMesh);
        Mesh->SetMobility(EComponentMobility::Movable);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Mesh->SetGenerateOverlapEvents(false);
        Actor->SetActorScale3D(FVector(
            FMath::Max(20.0, Entity.FootprintCm) / 100.0,
            FMath::Max(20.0, Entity.FootprintCm) / 100.0,
            FMath::Max(20.0, Entity.HeightCm) / 100.0
        ));
        Actor->Tags.Add(*FString::Printf(TEXT("Fenix.Token.%s"), *Entity.TokenId));
        RuntimeActors.Add(Actor);
    }
}
