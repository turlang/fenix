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
    RuntimeEntityActors.Reset();
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

AActor* AFenixWorldBuilder::SpawnEntityActor(const FFenixRuntimeEntity& Entity)
{
    if (!GetWorld() || !CylinderMesh || Entity.bViewer) return nullptr;

    AStaticMeshActor* Actor = GetWorld()->SpawnActor<AStaticMeshActor>(Entity.Location, FRotator(0.0, Entity.SceneRotationDegrees, 0.0));
    if (!Actor) return nullptr;

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
    Actor->SetActorHiddenInGame(!Entity.bVisible);
    Actor->Tags.Add(*FString::Printf(TEXT("Fenix.Token.%s"), *Entity.TokenId));
    RuntimeActors.Add(Actor);
    RuntimeEntityActors.Add(Entity.TokenId, Actor);
    return Actor;
}

FVector AFenixWorldBuilder::SceneStateToRuntimeLocation(const FFenixRuntimeEntityState& Entity, const FFenixRuntimeManifest& Manifest) const
{
    const double CmPerPixel = FMath::Max(0.0001, Manifest.Scene.CentimetersPerPixel);
    const double ElevationCm = Entity.Elevation * (Manifest.Scene.SceneUnit == TEXT("ft") ? 30.48 : 100.0);
    return FVector(
        Entity.ScenePosition.X * CmPerPixel,
        -Entity.ScenePosition.Y * CmPerPixel,
        ElevationCm
    );
}

void AFenixWorldBuilder::ApplySceneSync(const FFenixRuntimeStateSync& Sync, const FFenixRuntimeManifest& Manifest)
{
    for (const FFenixRuntimeEntityState& Entity : Sync.Entities)
    {
        if (Entity.TokenId == Manifest.Viewer.TokenId) continue;

        AActor* Actor = RuntimeEntityActors.FindRef(Entity.TokenId);
        if (!IsValid(Actor))
        {
            const FFenixRuntimeEntity* Initial = Manifest.Entities.FindByPredicate([&Entity](const FFenixRuntimeEntity& Candidate)
            {
                return Candidate.TokenId == Entity.TokenId;
            });
            FFenixRuntimeEntity SpawnData;
            if (Initial) SpawnData = *Initial;
            SpawnData.TokenId = Entity.TokenId;
            SpawnData.ActorId = Entity.ActorId;
            SpawnData.Location = SceneStateToRuntimeLocation(Entity, Manifest);
            SpawnData.SceneRotationDegrees = Entity.Rotation;
            SpawnData.bVisible = Entity.bVisible;
            Actor = SpawnEntityActor(SpawnData);
        }
        if (!IsValid(Actor)) continue;

        Actor->SetActorHiddenInGame(!Entity.bVisible);
        Actor->SetActorLocationAndRotation(
            SceneStateToRuntimeLocation(Entity, Manifest),
            FRotator(0.0, Entity.Rotation, 0.0),
            false,
            nullptr,
            ETeleportType::TeleportPhysics
        );
    }
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
        double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Delta.Y, Delta.X));
        FVector Midpoint(
            (Wall.A.X + Wall.B.X) * 0.5,
            (Wall.A.Y + Wall.B.Y) * 0.5,
            Wall.BottomZ + Height * 0.5
        );

        if (Wall.Kind == TEXT("door") && Wall.DoorState == TEXT("open"))
        {
            const double OpenYaw = Yaw + 90.0;
            const double Radians = FMath::DegreesToRadians(OpenYaw);
            Midpoint.X = Wall.A.X + FMath::Cos(Radians) * Length * 0.5;
            Midpoint.Y = Wall.A.Y + FMath::Sin(Radians) * Length * 0.5;
            Yaw = OpenYaw;
        }

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

        const FVector BoundsSize(FMath::Max(10.0, Max.X - Min.X), FMath::Max(10.0, Max.Y - Min.Y), 8.0);
        const FVector BoundsCenter((Min.X + Max.X) * 0.5, (Min.Y + Max.Y) * 0.5, Region.BaseZ - 4.0);

        if (Region.Kind == TEXT("stairs") && Region.bHasAxis)
        {
            constexpr int32 StepCount = 8;
            const FVector Axis = Region.AxisEnd - Region.AxisStart;
            for (int32 StepIndex = 0; StepIndex < StepCount; ++StepIndex)
            {
                const double Alpha0 = static_cast<double>(StepIndex) / StepCount;
                const double Alpha1 = static_cast<double>(StepIndex + 1) / StepCount;
                const FVector Start = FMath::Lerp(Region.AxisStart, Region.AxisEnd, Alpha0);
                const FVector End = FMath::Lerp(Region.AxisStart, Region.AxisEnd, Alpha1);
                const double StepZ = FMath::Lerp(Region.BaseZ, Region.TargetZ, Alpha1);
                const FVector Segment = End - Start;
                const double Length = FMath::Max(10.0, FVector2D(Segment.X, Segment.Y).Size());
                const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Segment.Y, Segment.X));
                SpawnBox(
                    FString::Printf(TEXT("Fenix.Region.stairs.%s.%d"), *Region.Id, StepIndex),
                    FVector((Start.X + End.X) * 0.5, (Start.Y + End.Y) * 0.5, StepZ - 4.0),
                    FVector(Length, BoundsSize.Y, 8.0),
                    FRotator(0.0, Yaw, 0.0)
                );
            }
            continue;
        }

        FRotator Rotation = FRotator::ZeroRotator;
        FVector Center = BoundsCenter;
        if (Region.bHasAxis && Region.Kind == TEXT("ramp"))
        {
            const FVector Axis = Region.AxisEnd - Region.AxisStart;
            const double Horizontal = FMath::Max(1.0, FVector2D(Axis.X, Axis.Y).Size());
            const double Pitch = -FMath::RadiansToDegrees(FMath::Atan2(Region.TargetZ - Region.BaseZ, Horizontal));
            const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Axis.Y, Axis.X));
            Rotation = FRotator(Pitch, Yaw, 0.0);
            Center.Z = (Region.BaseZ + Region.TargetZ) * 0.5 - 4.0;
        }

        SpawnBox(FString::Printf(TEXT("Fenix.Region.%s.%s"), *Region.Kind, *Region.Id), Center, BoundsSize, Rotation);
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
    for (const FFenixRuntimeEntity& Entity : Manifest.Entities)
    {
        if (Entity.bViewer) continue;
        SpawnEntityActor(Entity);
    }
}
