using UnrealBuildTool;
using System.Collections.Generic;

public class Fenix3DEditorTarget : TargetRules
{
    public Fenix3DEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;
        ExtraModuleNames.Add("Fenix3D");
    }
}
