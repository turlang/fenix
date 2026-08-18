#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "FenixRuntimeTypes.h"
#include "FenixWorldBuilder.generated.h"

UCLASS()
class FENIX3D_API AFenixWorldBuilder : public AActor
{
    GENERATED_BODY()

public:
    AFenixWorldBuilder();

    void BuildWorld(const FFenixRuntimeManifest& Manifest);
    void ClearWorld();

private:
    UPROPERTY()
    TArray<TObjectPtr<AActor>> RuntimeActors;

    UPROPERTY()
    TObjectPtr<UStaticMesh> CubeMesh;

    UPROPERTY()
    TObjectPtr<UStaticMesh> CylinderMesh;

    AActor* SpawnBox(const FString& Label, const FVector& Location, const FVector& SizeCm, const FRotator& Rotation = FRotator::ZeroRotator);
    void BuildBaseFloor(const FFenixRuntimeManifest& Manifest);
    void BuildWalls(const FFenixRuntimeManifest& Manifest);
    void BuildRegions(const FFenixRuntimeManifest& Manifest);
    void BuildLights(const FFenixRuntimeManifest& Manifest);
    void BuildEntities(const FFenixRuntimeManifest& Manifest);
};
