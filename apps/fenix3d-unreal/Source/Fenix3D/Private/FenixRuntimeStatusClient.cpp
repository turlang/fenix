#include "FenixRuntimeStatusClient.h"

#include "Dom/JsonObject.h"
#include "HAL/PlatformMisc.h"
#include "HttpModule.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

void UFenixRuntimeStatusClient::Start()
{
    StatusUrl = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_RUNTIME_STATUS_URL"));
    AccessToken = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_RUNTIME_STATUS_TOKEN"));
    RenderSessionId = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_RENDER_SESSION_ID"));
    CampaignId = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_CAMPAIGN_ID"));
    SceneId = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_SCENE_ID"));
    ActorId = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_ACTOR_ID"));
    TokenId = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_TOKEN_ID"));
}

bool UFenixRuntimeStatusClient::IsConfigured() const
{
    return !StatusUrl.IsEmpty() && !AccessToken.IsEmpty() && !RenderSessionId.IsEmpty();
}

void UFenixRuntimeStatusClient::ReportBooting()
{
    Report(TEXT("booting"), nullptr, false, false);
}

void UFenixRuntimeStatusClient::ReportManifestReady(const FFenixRuntimeManifest& Manifest)
{
    Report(TEXT("manifest-ready"), &Manifest, false, false);
}

void UFenixRuntimeStatusClient::ReportReady(const FFenixRuntimeManifest& Manifest, bool bWorldBuilt, bool bControlConfigured)
{
    if (!bWorldBuilt || !bControlConfigured)
    {
        ReportFailure(!bWorldBuilt
            ? TEXT("WorldBuilder não construiu a cena 3D.")
            : TEXT("Canal autoritativo de controle não está configurado."));
        return;
    }
    Report(TEXT("ready"), &Manifest, true, true);
}

void UFenixRuntimeStatusClient::ReportFailure(const FString& Message)
{
    Report(TEXT("failed"), nullptr, false, false, Message.Left(500));
}

void UFenixRuntimeStatusClient::Report(
    const FString& Stage,
    const FFenixRuntimeManifest* Manifest,
    bool bWorldBuilt,
    bool bControlConfigured,
    const FString& Message)
{
    if (!IsConfigured()) return;

    TSharedRef<FJsonObject> Root = MakeShared<FJsonObject>();
    Root->SetStringField(TEXT("stage"), Stage);
    Root->SetStringField(TEXT("campaignId"), Manifest ? Manifest->CampaignId : CampaignId);
    Root->SetStringField(TEXT("sceneId"), Manifest ? Manifest->Scene.Id : SceneId);
    Root->SetStringField(TEXT("actorId"), Manifest ? Manifest->Viewer.ActorId : ActorId);
    Root->SetStringField(TEXT("tokenId"), Manifest ? Manifest->Viewer.TokenId : TokenId);
    Root->SetBoolField(TEXT("worldBuilt"), bWorldBuilt);
    Root->SetBoolField(TEXT("controlConfigured"), bControlConfigured);
    if (Manifest)
    {
        Root->SetStringField(TEXT("manifestSchema"), Manifest->Schema);
        Root->SetNumberField(TEXT("manifestVersion"), Manifest->Version);
    }
    if (!Message.IsEmpty()) Root->SetStringField(TEXT("message"), Message.Left(500));

    FString Body;
    const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Body);
    if (!FJsonSerializer::Serialize(Root, Writer))
    {
        OnStatusError.Broadcast(TEXT("Falha ao serializar runtime evidence."));
        return;
    }

    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetURL(StatusUrl);
    Request->SetVerb(TEXT("POST"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Bearer %s"), *AccessToken));
    Request->SetContentAsString(Body);
    Request->OnProcessRequestComplete().BindUObject(this, &UFenixRuntimeStatusClient::HandleReportResponse);

    if (!Request->ProcessRequest())
    {
        OnStatusError.Broadcast(TEXT("Não foi possível enviar runtime evidence ao Render Node."));
    }
}

void UFenixRuntimeStatusClient::HandleReportResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSucceeded)
{
    if (!bSucceeded || !Response.IsValid())
    {
        OnStatusError.Broadcast(TEXT("Render Node não respondeu ao runtime evidence."));
        return;
    }
    const int32 StatusCode = Response->GetResponseCode();
    if (StatusCode < 200 || StatusCode >= 300)
    {
        OnStatusError.Broadcast(FString::Printf(TEXT("Runtime evidence recusado pelo Render Node (HTTP %d)."), StatusCode));
    }
}
