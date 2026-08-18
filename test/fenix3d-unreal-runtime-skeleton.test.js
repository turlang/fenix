import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const unreal = (path) => new URL(`apps/fenix3d-unreal/${path}`, ROOT);

async function source(url) {
  return readFile(url, 'utf8');
}

test('Fenix3D is a real UE5.5 project with Pixel Streaming 2 and targets at Source root', async () => {
  const project = JSON.parse(await source(unreal('Fenix3D.uproject')));
  const build = await source(unreal('Source/Fenix3D/Fenix3D.Build.cs'));
  const gameTarget = await source(unreal('Source/Fenix3D.Target.cs'));
  const editorTarget = await source(unreal('Source/Fenix3DEditor.Target.cs'));

  assert.equal(project.EngineAssociation, '5.5');
  assert.ok(project.Plugins.some((plugin) => plugin.Name === 'PixelStreaming2' && plugin.Enabled === true));
  assert.match(build, /"HTTP"/);
  assert.match(build, /"Json"/);
  assert.match(gameTarget, /TargetType\.Game/);
  assert.match(editorTarget, /TargetType\.Editor/);
});

test('bootstrap client fetches only the scoped runtime manifest and validates its schema', async () => {
  const code = await source(unreal('Source/Fenix3D/Private/FenixRuntimeBootstrapClient.cpp'));

  assert.match(code, /FENIX_RUNTIME_MANIFEST_URL/);
  assert.match(code, /FENIX_RUNTIME_MANIFEST_TOKEN/);
  assert.match(code, /Authorization/);
  assert.match(code, /fenix\.3d-runtime-manifest/);
  assert.match(code, /Version == 1|IsCompatible\(\)/);
  assert.doesNotMatch(code, /campaign-service|authoritative-token-runtime|fenix-vtt/);
});

test('WorldBuilder materializes geometry but disables local collision authority', async () => {
  const code = await source(unreal('Source/Fenix3D/Private/FenixWorldBuilder.cpp'));

  assert.match(code, /BuildBaseFloor/);
  assert.match(code, /BuildWalls/);
  assert.match(code, /BuildRegions/);
  assert.match(code, /BuildLights/);
  assert.match(code, /BuildEntities/);
  assert.match(code, /ECollisionEnabled::NoCollision/);
  assert.doesNotMatch(code, /resolveTokenMovement|scene-collision|authoritative-token-runtime/);
});

test('First Person Pawn captures WASD mouse run and action without moving itself authoritatively', async () => {
  const code = await source(unreal('Source/Fenix3D/Private/FenixFirstPersonPawn.cpp'));

  assert.match(code, /BindAxis\(TEXT\("MoveForward"\)/);
  assert.match(code, /BindAxis\(TEXT\("MoveRight"\)/);
  assert.match(code, /BindAxis\(TEXT\("LookYaw"\)/);
  assert.match(code, /BindAxis\(TEXT\("LookPitch"\)/);
  assert.match(code, /BindAction\(TEXT\("Run"\)/);
  assert.match(code, /BindAction\(TEXT\("PrimaryAction"\)/);
  assert.doesNotMatch(code, /AddMovementInput|UFloatingPawnMovement|UCharacterMovementComponent/);
  assert.match(code, /ApplyAuthoritativeState/);
  assert.match(code, /State\.ScenePosition/);
});

test('runtime control serializes semantic intents and reconciles only server state-sync', async () => {
  const code = await source(unreal('Source/Fenix3D/Private/FenixRuntimeControlClient.cpp'));
  const sendSide = code.slice(0, code.indexOf('void UFenixRuntimeControlClient::HandleControlResponse'));

  assert.match(sendSide, /TEXT\("move"\)/);
  assert.match(sendSide, /TEXT\("look"\)/);
  assert.match(sendSide, /TEXT\("action"\)/);
  assert.match(sendSide, /SetObjectField\(TEXT\("intent"\)/);
  assert.match(sendSide, /PendingBodies/);
  assert.match(sendSide, /bRequestInFlight/);
  assert.doesNotMatch(sendSide, /SetNumberField\(TEXT\("x"\)|SetNumberField\(TEXT\("y"\)|SetNumberField\(TEXT\("z"\)|teleport/i);

  assert.match(code, /fenix\.3d-runtime-state-sync/);
  assert.match(code, /OnStateSync\.Broadcast/);
  assert.match(code, /FENIX_RUNTIME_CONTROL_TOKEN/);
});

test('runtime game mode composes bootstrap, world, pawn and Core reconciliation', async () => {
  const code = await source(unreal('Source/Fenix3D/Private/FenixRuntimeGameMode.cpp'));

  assert.match(code, /BootstrapClient->Start\(\)/);
  assert.match(code, /ControlClient->Start\(\)/);
  assert.match(code, /WorldBuilder->BuildWorld/);
  assert.match(code, /InitializeFromManifest/);
  assert.match(code, /Sync\.TokenId != CurrentManifest\.Viewer\.TokenId/);
  assert.match(code, /Sync\.ActorId != CurrentManifest\.Viewer\.ActorId/);
  assert.match(code, /ApplyAuthoritativeState/);
});

test('Render Node already injects private manifest and runtime-control credentials into Fenix3D', async () => {
  const launcher = await source(new URL('apps/render-node/src/runtime-launcher.js', ROOT));

  assert.match(launcher, /FENIX_RUNTIME_MANIFEST_URL/);
  assert.match(launcher, /FENIX_RUNTIME_MANIFEST_TOKEN/);
  assert.match(launcher, /FENIX_RUNTIME_CONTROL_URL/);
  assert.match(launcher, /FENIX_RUNTIME_CONTROL_TOKEN/);
  assert.match(launcher, /shell: false/);
});
