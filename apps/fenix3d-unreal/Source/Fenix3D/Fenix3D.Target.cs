using UnrealBuildTool;
using System.Collections.Generic;

public class Fenix3DTarget : TargetRules
{
    public Fenix3DTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;
        ExtraModuleNames.Add("Fenix3D");
    }
}
