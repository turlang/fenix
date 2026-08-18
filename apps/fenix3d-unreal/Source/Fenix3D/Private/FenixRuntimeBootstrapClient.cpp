#include "FenixRuntimeBootstrapClient.h"

#include "Dom/JsonObject.h"
#include "HAL/PlatformMisc.h"
#include "HttpModule.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
TSharedPtr<FJsonObject> ObjectField(const TSharedPtr<FJsonObject>& Parent, const TCHAR* Name)
{
    if (!Parent.IsValid()) return nullptr;
    const TSharedPtr<FJsonObject>* Found = nullptr;
    return Parent->TryGetObjectField(Name, Found) && Found ? *Found : nullptr;
}

const TArray<TSharedPtr<FJsonValue>>* ArrayField(const TSharedPtr<FJsonObject>& Parent, const TCHAR* Name)
{
    if (!Parent.IsValid()) return nullptr;
    const TArray<TSharedPtr<FJsonValue>>* Found = nullptr;
    return Parent->TryGetArrayField(Name, Found) ? Found : nullptr;
}

FString StringField(const TSharedPtr<FJsonObject>& Object, const TCHAR* Name, const FString& Fallback = FString())
{
    FString Value;
    return Object.IsValid() && Object->TryGetStringField(Name, Value) ? Value : Fallback;
}

double NumberField(const TSharedPtr<FJsonObject>& Object, const TCHAR* Name, double Fallback = 0.0)
{
    double Value = 0.0;
    return Object.IsValid() && Object->TryGetNumberField(Name, Value) ? Value : Fallback;
}

bool BoolField(const TSharedPtr<FJsonObject>& Object, const TCHAR* Name, bool Fallback = false)
{
    bool Value = false;
    return Object.IsValid() && Object->TryGetBoolField(Name, Value) ? Value : Fallback;
}

FVector VectorField(const TSharedPtr<FJsonObject>& Parent, const TCHAR* Name)
{
    const TSharedPtr<FJsonObject> Object = ObjectField(Parent, Name);
    if (!Object.IsValid()) return FVector::ZeroVector;
    return FVector(
        NumberField(Object, TEXT("x")),
        NumberField(Object, TEXT("y")),
        NumberField(Object, TEXT("z"))
    );
}
}

void UFenixRuntimeBootstrapClient::Start()
{
    FString Url = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_RUNTIME_MANIFEST_URL"));
    FString Token = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_RUNTIME_MANIFEST_TOKEN"));

    if (Url.IsEmpty()) Url = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_WORLD_BOOTSTRAP_URL"));
    if (Token.IsEmpty()) Token = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_WORLD_BOOTSTRAP_TOKEN"));

    if (Url.IsEmpty())
    {
        OnManifestError.Broadcast(TEXT("FENIX_RUNTIME_MANIFEST_URL não foi fornecida pelo Render Node."));
        return;
    }

    FetchManifest(Url, Token);
}

void UFenixRuntimeBootstrapClient::FetchManifest(const FString& Url, const FString& AccessToken)
{
    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetURL(Url);
    Request->SetVerb(TEXT("GET"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    if (!AccessToken.IsEmpty())
    {
        Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Bearer %s"), *AccessToken));
    }
    Request->OnProcessRequestComplete().BindUObject(this, &UFenixRuntimeBootstrapClient::HandleManifestResponse);

    if (!Request->ProcessRequest())
    {
        OnManifestError.Broadcast(TEXT("Não foi possível iniciar a requisição do manifest 3D."));
    }
}

void UFenixRuntimeBootstrapClient::HandleManifestResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSucceeded)
{
    if (!bSucceeded || !Response.IsValid())
    {
        OnManifestError.Broadcast(TEXT("Render Node não respondeu ao bootstrap do runtime 3D."));
        return;
    }

    const int32 StatusCode = Response->GetResponseCode();
    if (StatusCode < 200 || StatusCode >= 300)
    {
        OnManifestError.Broadcast(FString::Printf(TEXT("Manifest 3D recusado pelo Render Node (HTTP %d)."), StatusCode));
        return;
    }

    FFenixRuntimeManifest Manifest;
    FString Error;
    if (!ParseManifestJson(Response->GetContentAsString(), Manifest, Error))
    {
        OnManifestError.Broadcast(Error);
        return;
    }

    OnManifestReady.Broadcast(Manifest);
}

bool UFenixRuntimeBootstrapClient::ParseManifestJson(const FString& Json, FFenixRuntimeManifest& OutManifest, FString& OutError)
{
    TSharedPtr<FJsonObject> Root;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
    if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
    {
        OutError = TEXT("Manifest 3D contém JSON inválido.");
        return false;
    }

    OutManifest = FFenixRuntimeManifest{};
    OutManifest.Schema = StringField(Root, TEXT("schema"));
    OutManifest.Version = static_cast<int32>(NumberField(Root, TEXT("version")));
    OutManifest.CreatedAt = StringField(Root, TEXT("createdAt"));

    const TSharedPtr<FJsonObject> Campaign = ObjectField(Root, TEXT("campaign"));
    OutManifest.CampaignId = StringField(Campaign, TEXT("id"));
    OutManifest.CampaignTitle = StringField(Campaign, TEXT("title"));
    OutManifest.CampaignSystemId = StringField(Campaign, TEXT("systemId"));

    const TSharedPtr<FJsonObject> Scene = ObjectField(Root, TEXT("scene"));
    const TSharedPtr<FJsonObject> Dimensions = ObjectField(Scene, TEXT("dimensions"));
    const TSharedPtr<FJsonObject> Units = ObjectField(Scene, TEXT("units"));
    OutManifest.Scene.Id = StringField(Scene, TEXT("id"));
    OutManifest.Scene.Name = StringField(Scene, TEXT("name"));
    OutManifest.Scene.WidthCm = NumberField(Dimensions, TEXT("widthCm"), 1.0);
    OutManifest.Scene.HeightCm = NumberField(Dimensions, TEXT("heightCm"), 1.0);
    OutManifest.Scene.CentimetersPerPixel = NumberField(Units, TEXT("centimetersPerPixel"), 1.0);
    OutManifest.Scene.BackgroundAssetId = StringField(Scene, TEXT("backgroundAssetId"));
    OutManifest.Scene.Darkness = NumberField(Scene, TEXT("darkness"));
    OutManifest.Scene.bLightingEnabled = BoolField(Scene, TEXT("lightingEnabled"));

    const TSharedPtr<FJsonObject> Geometry = ObjectField(Root, TEXT("geometry"));
    if (const TArray<TSharedPtr<FJsonValue>>* Walls = ArrayField(Geometry, TEXT("walls")))
    {
        for (const TSharedPtr<FJsonValue>& Value : *Walls)
        {
            const TSharedPtr<FJsonObject> Object = Value.IsValid() ? Value->AsObject() : nullptr;
            if (!Object.IsValid()) continue;
            FFenixRuntimeWall Wall;
            Wall.Id = StringField(Object, TEXT("id"));
            Wall.Kind = StringField(Object, TEXT("kind"), TEXT("wall"));
            Wall.DoorState = StringField(Object, TEXT("doorState"));
            Wall.bBlocksMovement = BoolField(Object, TEXT("blocksMovement"), true);
            Wall.bBlocksVision = BoolField(Object, TEXT("blocksVision"), true);
            Wall.A = VectorField(Object, TEXT("a"));
            Wall.B = VectorField(Object, TEXT("b"));
            Wall.BottomZ = NumberField(Object, TEXT("bottomZ"));
            Wall.TopZ = NumberField(Object, TEXT("topZ"), 300.0);
            Wall.HeightCm = NumberField(Object, TEXT("heightCm"), Wall.TopZ - Wall.BottomZ);
            Wall.RecommendedThicknessCm = NumberField(Object, TEXT("recommendedThicknessCm"), 10.0);
            OutManifest.Walls.Add(MoveTemp(Wall));
        }
    }

    if (const TArray<TSharedPtr<FJsonValue>>* Regions = ArrayField(Geometry, TEXT("regions")))
    {
        for (const TSharedPtr<FJsonValue>& Value : *Regions)
        {
            const TSharedPtr<FJsonObject> Object = Value.IsValid() ? Value->AsObject() : nullptr;
            if (!Object.IsValid()) continue;
            FFenixRuntimeRegion Region;
            Region.Id = StringField(Object, TEXT("id"));
            Region.Name = StringField(Object, TEXT("name"));
            Region.Kind = StringField(Object, TEXT("kind"), TEXT("floor"));
            Region.bEnabled = BoolField(Object, TEXT("enabled"), true);
            Region.Priority = static_cast<int32>(NumberField(Object, TEXT("priority")));
            Region.BaseZ = NumberField(Object, TEXT("baseZ"));
            Region.TargetZ = NumberField(Object, TEXT("targetZ"), Region.BaseZ);
            if (const TArray<TSharedPtr<FJsonValue>>* Points = ArrayField(Object, TEXT("points")))
            {
                for (const TSharedPtr<FJsonValue>& PointValue : *Points)
                {
                    const TSharedPtr<FJsonObject> PointObject = PointValue.IsValid() ? PointValue->AsObject() : nullptr;
                    if (PointObject.IsValid())
                    {
                        Region.Points.Add(FVector(
                            NumberField(PointObject, TEXT("x")),
                            NumberField(PointObject, TEXT("y")),
                            NumberField(PointObject, TEXT("z"), Region.BaseZ)
                        ));
                    }
                }
            }
            if (const TSharedPtr<FJsonObject> Axis = ObjectField(Object, TEXT("axis")); Axis.IsValid())
            {
                Region.AxisStart = VectorField(Axis, TEXT("start"));
                Region.AxisEnd = VectorField(Axis, TEXT("end"));
                Region.bHasAxis = true;
            }
            OutManifest.Regions.Add(MoveTemp(Region));
        }
    }

    if (const TArray<TSharedPtr<FJsonValue>>* Levels = ArrayField(Geometry, TEXT("levels")))
    {
        for (const TSharedPtr<FJsonValue>& Value : *Levels)
        {
            const TSharedPtr<FJsonObject> Object = Value.IsValid() ? Value->AsObject() : nullptr;
            if (!Object.IsValid()) continue;
            FFenixRuntimeLevel Level;
            Level.Id = StringField(Object, TEXT("id"));
            Level.Name = StringField(Object, TEXT("name"));
            Level.ElevationCm = NumberField(Object, TEXT("elevationCm"));
            OutManifest.Levels.Add(MoveTemp(Level));
        }
    }

    if (const TArray<TSharedPtr<FJsonValue>>* Lights = ArrayField(Root, TEXT("lights")))
    {
        for (const TSharedPtr<FJsonValue>& Value : *Lights)
        {
            const TSharedPtr<FJsonObject> Object = Value.IsValid() ? Value->AsObject() : nullptr;
            if (!Object.IsValid()) continue;
            FFenixRuntimeLight Light;
            Light.Id = StringField(Object, TEXT("id"));
            Light.Name = StringField(Object, TEXT("name"));
            Light.bEnabled = BoolField(Object, TEXT("enabled"), true);
            Light.ColorHex = StringField(Object, TEXT("color"), TEXT("#f2c66f"));
            Light.Intensity = NumberField(Object, TEXT("intensity"), 1.0);
            Light.RadiusCm = NumberField(Object, TEXT("radiusCm"), 600.0);
            Light.AttachedTokenId = StringField(Object, TEXT("attachedTokenId"));
            Light.Location = VectorField(Object, TEXT("location"));
            OutManifest.Lights.Add(MoveTemp(Light));
        }
    }

    if (const TArray<TSharedPtr<FJsonValue>>* Entities = ArrayField(Root, TEXT("entities")))
    {
        for (const TSharedPtr<FJsonValue>& Value : *Entities)
        {
            const TSharedPtr<FJsonObject> Object = Value.IsValid() ? Value->AsObject() : nullptr;
            if (!Object.IsValid()) continue;
            const TSharedPtr<FJsonObject> Transform = ObjectField(Object, TEXT("transform"));
            const TSharedPtr<FJsonObject> EntityDimensions = ObjectField(Object, TEXT("dimensions"));
            FFenixRuntimeEntity Entity;
            Entity.TokenId = StringField(Object, TEXT("tokenId"));
            Entity.ActorId = StringField(Object, TEXT("actorId"));
            Entity.SheetId = StringField(Object, TEXT("sheetId"));
            Entity.SystemId = StringField(Object, TEXT("systemId"));
            Entity.Name = StringField(Object, TEXT("name"));
            Entity.Kind = StringField(Object, TEXT("kind"));
            Entity.Image = StringField(Object, TEXT("image"));
            Entity.bViewer = BoolField(Object, TEXT("viewer"));
            Entity.bVisible = BoolField(Object, TEXT("visible"), true);
            Entity.Location = VectorField(Transform, TEXT("location"));
            Entity.SceneRotationDegrees = NumberField(Transform, TEXT("sceneRotationDegrees"));
            Entity.FootprintCm = NumberField(EntityDimensions, TEXT("footprintCm"), 150.0);
            Entity.HeightCm = NumberField(EntityDimensions, TEXT("heightCm"), 180.0);
            Entity.MovementMode = StringField(Object, TEXT("movementMode"), TEXT("ground"));
            OutManifest.Entities.Add(MoveTemp(Entity));
        }
    }

    const TSharedPtr<FJsonObject> Viewer = ObjectField(Root, TEXT("viewer"));
    const TSharedPtr<FJsonObject> Camera = ObjectField(Viewer, TEXT("camera"));
    OutManifest.Viewer.ActorId = StringField(Viewer, TEXT("actorId"));
    OutManifest.Viewer.TokenId = StringField(Viewer, TEXT("tokenId"));
    OutManifest.Viewer.SheetId = StringField(Viewer, TEXT("sheetId"));
    OutManifest.Viewer.SystemId = StringField(Viewer, TEXT("systemId"), TEXT("generic"));
    OutManifest.Viewer.Camera.Location = VectorField(Camera, TEXT("location"));
    OutManifest.Viewer.Camera.SceneRotationDegrees = NumberField(Camera, TEXT("sceneRotationDegrees"));
    OutManifest.Viewer.Camera.PitchDegrees = NumberField(Camera, TEXT("pitchDegrees"));
    OutManifest.Viewer.Camera.FovDegrees = NumberField(Camera, TEXT("fovDegrees"), 90.0);
    OutManifest.Viewer.Camera.EyeHeightCm = NumberField(Camera, TEXT("eyeHeightCm"), 160.0);
    OutManifest.Viewer.Camera.PreferredSense = StringField(Camera, TEXT("preferredSense"), TEXT("normal"));
    OutManifest.Viewer.Camera.VisionDistanceCm = NumberField(Camera, TEXT("visionDistanceCm"));

    const TSharedPtr<FJsonObject> Fog = ObjectField(Root, TEXT("fog"));
    OutManifest.bFogEnabled = BoolField(Fog, TEXT("enabled"));
    if (const TArray<TSharedPtr<FJsonValue>>* Explored = ArrayField(Fog, TEXT("exploredCells")))
    {
        for (const TSharedPtr<FJsonValue>& Value : *Explored)
        {
            FString Cell;
            if (Value.IsValid() && Value->TryGetString(Cell)) OutManifest.ExploredCells.Add(Cell);
        }
    }

    if (!OutManifest.IsCompatible())
    {
        OutError = TEXT("Manifest 3D incompatível: schema/version/viewer token inválidos.");
        return false;
    }

    return true;
}
