#include "FenixRuntimeControlClient.h"

#include "Dom/JsonObject.h"
#include "HAL/PlatformMisc.h"
#include "HttpModule.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

namespace
{
TSharedPtr<FJsonObject> ChildObject(const TSharedPtr<FJsonObject>& Parent, const TCHAR* Name)
{
    if (!Parent.IsValid()) return nullptr;
    const TSharedPtr<FJsonObject>* Found = nullptr;
    return Parent->TryGetObjectField(Name, Found) && Found ? *Found : nullptr;
}

FString ReadString(const TSharedPtr<FJsonObject>& Object, const TCHAR* Name)
{
    FString Value;
    return Object.IsValid() && Object->TryGetStringField(Name, Value) ? Value : FString();
}

double ReadNumber(const TSharedPtr<FJsonObject>& Object, const TCHAR* Name, double Fallback = 0.0)
{
    double Value = 0.0;
    return Object.IsValid() && Object->TryGetNumberField(Name, Value) ? Value : Fallback;
}

bool ReadBool(const TSharedPtr<FJsonObject>& Object, const TCHAR* Name, bool Fallback = false)
{
    bool Value = false;
    return Object.IsValid() && Object->TryGetBoolField(Name, Value) ? Value : Fallback;
}
}

void UFenixRuntimeControlClient::Start()
{
    ControlUrl = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_RUNTIME_CONTROL_URL"));
    AccessToken = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_RUNTIME_CONTROL_TOKEN"));
    RenderSessionId = FPlatformMisc::GetEnvironmentVariable(TEXT("FENIX_RENDER_SESSION_ID"));

    if (!IsConfigured())
    {
        OnControlError.Broadcast(TEXT("Canal de controle 3D não foi fornecido pelo Render Node."));
    }
}

bool UFenixRuntimeControlClient::IsConfigured() const
{
    return !ControlUrl.IsEmpty() && !AccessToken.IsEmpty();
}

void UFenixRuntimeControlClient::SendMove(float Forward, float Strafe, bool bRun)
{
    TSharedRef<FJsonObject> Intent = MakeShared<FJsonObject>();
    Intent->SetStringField(TEXT("type"), TEXT("move"));
    Intent->SetNumberField(TEXT("forward"), FMath::Clamp(Forward, -1.0f, 1.0f));
    Intent->SetNumberField(TEXT("strafe"), FMath::Clamp(Strafe, -1.0f, 1.0f));
    Intent->SetBoolField(TEXT("run"), bRun);
    QueueIntent(Intent);
}

void UFenixRuntimeControlClient::SendLook(float Yaw, float Pitch)
{
    TSharedRef<FJsonObject> Intent = MakeShared<FJsonObject>();
    Intent->SetStringField(TEXT("type"), TEXT("look"));
    Intent->SetNumberField(TEXT("yaw"), FMath::Clamp(Yaw, -180.0f, 180.0f));
    Intent->SetNumberField(TEXT("pitch"), FMath::Clamp(Pitch, -89.0f, 89.0f));
    QueueIntent(Intent);
}

void UFenixRuntimeControlClient::SendAction(const FString& Action, const FString& TargetId)
{
    if (Action.TrimStartAndEnd().IsEmpty()) return;

    TSharedRef<FJsonObject> Intent = MakeShared<FJsonObject>();
    Intent->SetStringField(TEXT("type"), TEXT("action"));
    Intent->SetStringField(TEXT("action"), Action.Left(80));
    if (!TargetId.IsEmpty()) Intent->SetStringField(TEXT("targetId"), TargetId.Left(200));
    QueueIntent(Intent);
}

void UFenixRuntimeControlClient::QueueIntent(const TSharedRef<FJsonObject>& Intent)
{
    if (!IsConfigured())
    {
        OnControlError.Broadcast(TEXT("Runtime Control indisponível; input não foi aplicado localmente."));
        return;
    }

    TSharedRef<FJsonObject> Root = MakeShared<FJsonObject>();
    Root->SetNumberField(TEXT("sequence"), static_cast<double>(NextSequence++));
    Root->SetObjectField(TEXT("intent"), Intent);

    FString Body;
    const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Body);
    if (!FJsonSerializer::Serialize(Root, Writer))
    {
        OnControlError.Broadcast(TEXT("Falha ao serializar input do runtime 3D."));
        return;
    }

    PendingBodies.Add(MoveTemp(Body));
    PumpQueue();
}

void UFenixRuntimeControlClient::PumpQueue()
{
    if (bRequestInFlight || PendingBodies.IsEmpty() || !IsConfigured()) return;

    bRequestInFlight = true;
    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetURL(ControlUrl);
    Request->SetVerb(TEXT("POST"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Bearer %s"), *AccessToken));
    Request->SetContentAsString(PendingBodies[0]);
    Request->OnProcessRequestComplete().BindUObject(this, &UFenixRuntimeControlClient::HandleControlResponse);

    if (!Request->ProcessRequest())
    {
        bRequestInFlight = false;
        PendingBodies.RemoveAt(0);
        OnControlError.Broadcast(TEXT("Não foi possível enviar input ao Fênix Core."));
        PumpQueue();
    }
}

void UFenixRuntimeControlClient::HandleControlResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSucceeded)
{
    if (!PendingBodies.IsEmpty()) PendingBodies.RemoveAt(0);
    bRequestInFlight = false;

    if (!bSucceeded || !Response.IsValid())
    {
        OnControlError.Broadcast(TEXT("Fênix Core não respondeu ao input do runtime 3D."));
        PumpQueue();
        return;
    }

    const int32 StatusCode = Response->GetResponseCode();
    if (StatusCode < 200 || StatusCode >= 300)
    {
        OnControlError.Broadcast(FString::Printf(TEXT("Input 3D recusado pelo Core (HTTP %d)."), StatusCode));
        PumpQueue();
        return;
    }

    TSharedPtr<FJsonObject> Root;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Response->GetContentAsString());
    if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
    {
        OnControlError.Broadcast(TEXT("Resposta do Runtime Control contém JSON inválido."));
        PumpQueue();
        return;
    }

    const TSharedPtr<FJsonObject> Result = ChildObject(Root, TEXT("result"));
    const FString Schema = ReadString(Result, TEXT("schema"));
    if (Schema == TEXT("fenix.3d-runtime-state-sync"))
    {
        FFenixRuntimeStateSync Sync;
        if (ParseStateSync(Result, Sync)) OnStateSync.Broadcast(Sync);
        else OnControlError.Broadcast(TEXT("State sync 3D recebido com campos obrigatórios ausentes."));
    }
    else if (Schema == TEXT("fenix.3d-runtime-action-result"))
    {
        OnActionResult.Broadcast(Response->GetContentAsString());
    }
    else
    {
        OnControlError.Broadcast(TEXT("Resposta do Runtime Control usa schema desconhecido."));
    }

    PumpQueue();
}

bool UFenixRuntimeControlClient::ParseStateSync(const TSharedPtr<FJsonObject>& Result, FFenixRuntimeStateSync& OutSync) const
{
    if (!Result.IsValid()) return false;
    const TSharedPtr<FJsonObject> Token = ChildObject(Result, TEXT("token"));
    if (!Token.IsValid()) return false;

    OutSync = FFenixRuntimeStateSync{};
    OutSync.RenderSessionId = ReadString(Result, TEXT("renderSessionId"));
    OutSync.Revision = static_cast<int64>(ReadNumber(Result, TEXT("revision")));
    OutSync.TokenId = ReadString(Token, TEXT("tokenId"));
    OutSync.ActorId = ReadString(Token, TEXT("actorId"));
    OutSync.ScenePosition.X = ReadNumber(Token, TEXT("x"));
    OutSync.ScenePosition.Y = ReadNumber(Token, TEXT("y"));
    OutSync.Elevation = ReadNumber(Token, TEXT("elevation"));
    OutSync.Rotation = ReadNumber(Token, TEXT("rotation"));
    OutSync.MovementMode = ReadString(Token, TEXT("movementMode"));

    const TSharedPtr<FJsonObject> Collision = ChildObject(Result, TEXT("collision"));
    OutSync.bCollisionBlocked = ReadBool(Collision, TEXT("blocked"));
    OutSync.CollisionWallId = ReadString(Collision, TEXT("wallId"));

    return !OutSync.TokenId.IsEmpty() && (RenderSessionId.IsEmpty() || OutSync.RenderSessionId == RenderSessionId);
}
