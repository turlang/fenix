import { requireAuthenticatedRequest } from './register-auth-routes.js';

const ASSET_UPLOAD_BODY_LIMIT = 24 * 1024 * 1024;

function sendError(reply, error, fallback = 'SCENE_REQUEST_FAILED') {
  const status = Number(error?.statusCode) || 400;
  return reply.code(status).send({
    code: error?.code || fallback,
    message: error?.message || 'Falha ao processar cena.'
  });
}

export function registerSceneRoutes(app, { authService, sceneService }) {
  if (!app || !authService || !sceneService) throw new TypeError('app, authService e sceneService são obrigatórios.');

  app.get('/v1/campaigns/:campaignId/scenes', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return sceneService.list({ campaignId: request.params.campaignId, userId: authenticated.user.id });
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/campaigns/:campaignId/assets', { bodyLimit: ASSET_UPLOAD_BODY_LIMIT }, async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      const asset = await sceneService.uploadMap({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        fileName: request.body?.fileName,
        mimeType: request.body?.mimeType,
        dataBase64: request.body?.dataBase64
      });
      return { asset };
    } catch (error) { return sendError(reply, error, 'CAMPAIGN_ASSET_UPLOAD_FAILED'); }
  });

  app.post('/v1/campaigns/:campaignId/assets/import-url', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      const asset = await sceneService.importMapUrl({ campaignId: request.params.campaignId, userId: authenticated.user.id, url: request.body?.url });
      return { asset };
    } catch (error) { return sendError(reply, error, 'CAMPAIGN_REMOTE_MAP_IMPORT_FAILED'); }
  });

  app.get('/v1/campaigns/:campaignId/assets/:assetId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      const { asset, buffer } = await sceneService.readAsset({ campaignId: request.params.campaignId, userId: authenticated.user.id, assetId: request.params.assetId });
      reply.header('Cache-Control', 'private, max-age=3600');
      reply.type(asset.mimeType);
      return reply.send(buffer);
    } catch (error) { return sendError(reply, error, 'CAMPAIGN_ASSET_READ_FAILED'); }
  });

  app.post('/v1/campaigns/:campaignId/scenes', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await sceneService.createScene({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        name: request.body?.name,
        description: request.body?.description,
        assetId: request.body?.assetId,
        width: request.body?.width,
        height: request.body?.height,
        gridSize: request.body?.gridSize
      });
    } catch (error) { return sendError(reply, error, 'CAMPAIGN_SCENE_CREATE_FAILED'); }
  });

  app.post('/v1/campaigns/:campaignId/scenes/:sceneId/grid', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await sceneService.updateGrid({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        sceneId: request.params.sceneId,
        size: request.body?.size,
        offsetX: request.body?.offsetX,
        offsetY: request.body?.offsetY,
        visible: request.body?.visible
      });
    } catch (error) { return sendError(reply, error, 'CAMPAIGN_SCENE_GRID_UPDATE_FAILED'); }
  });

  app.post('/v1/campaigns/:campaignId/scenes/:sceneId/walls', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await sceneService.updateWalls({ campaignId: request.params.campaignId, userId: authenticated.user.id, sceneId: request.params.sceneId, walls: request.body?.walls });
    } catch (error) { return sendError(reply, error, 'CAMPAIGN_SCENE_WALLS_UPDATE_FAILED'); }
  });

  app.post('/v1/campaigns/:campaignId/scenes/:sceneId/regions', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await sceneService.updateRegions({ campaignId: request.params.campaignId, userId: authenticated.user.id, sceneId: request.params.sceneId, regions: request.body?.regions });
    } catch (error) { return sendError(reply, error, 'CAMPAIGN_SCENE_REGIONS_UPDATE_FAILED'); }
  });

  app.post('/v1/campaigns/:campaignId/scenes/:sceneId/fog', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await sceneService.updateFog({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        sceneId: request.params.sceneId,
        enabled: request.body?.enabled,
        visionRangeCells: request.body?.visionRangeCells,
        exploredOpacity: request.body?.exploredOpacity,
        unexploredOpacity: request.body?.unexploredOpacity,
        visionProfiles: request.body?.visionProfiles,
        sceneElevation: request.body?.sceneElevation,
        resetExploration: request.body?.resetExploration === true
      });
    } catch (error) { return sendError(reply, error, 'CAMPAIGN_SCENE_FOG_UPDATE_FAILED'); }
  });

  app.post('/v1/campaigns/:campaignId/scenes/:sceneId/lighting', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await sceneService.updateLighting({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        sceneId: request.params.sceneId,
        enabled: request.body?.enabled,
        darkness: request.body?.darkness,
        sources: request.body?.sources
      });
    } catch (error) { return sendError(reply, error, 'CAMPAIGN_SCENE_LIGHTING_UPDATE_FAILED'); }
  });

  app.post('/v1/campaigns/:campaignId/scenes/:sceneId/activate', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await sceneService.activateScene({ campaignId: request.params.campaignId, userId: authenticated.user.id, sceneId: request.params.sceneId });
    } catch (error) { return sendError(reply, error, 'CAMPAIGN_SCENE_ACTIVATE_FAILED'); }
  });
}
