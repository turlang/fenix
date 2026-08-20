import { requireAuthenticatedRequest } from './register-auth-routes.js';

const CONTENT_IMPORT_BODY_LIMIT = 36 * 1024 * 1024;

function sendError(reply, error, fallback = 'CONTENT_REQUEST_FAILED') {
  const status = Number(error?.statusCode) || 400;
  return reply.code(status).send({
    code: error?.code || fallback,
    message: error?.message || 'Falha ao processar conteúdo.'
  });
}

export function registerContentRoutes(app, { authService, contentImportService, sceneService = null }) {
  if (!app || !authService || !contentImportService) throw new TypeError('app, authService e contentImportService são obrigatórios.');
  if (sceneService && !contentImportService.sceneService) contentImportService.sceneService = sceneService;

  app.get('/v1/campaigns/:campaignId/content', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await contentImportService.list({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/v1/campaigns/:campaignId/content/:adventureId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await contentImportService.get({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        adventureId: request.params.adventureId
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/v1/campaigns/:campaignId/content/import-pdf', { bodyLimit: CONTENT_IMPORT_BODY_LIMIT }, async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await contentImportService.importPdf({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        fileName: request.body?.fileName,
        dataBase64: request.body?.dataBase64,
        title: request.body?.title,
        targetLanguage: request.body?.targetLanguage,
        localize: request.body?.localize,
        reviewThreshold: request.body?.reviewThreshold,
        autoAcceptConfidence: request.body?.autoAcceptConfidence,
        ocrTrustedConfidence: request.body?.ocrTrustedConfidence,
        ocrMinimumReviewConfidence: request.body?.ocrMinimumReviewConfidence,
        minimumImagePixels: request.body?.minimumImagePixels
      });
    } catch (error) {
      return sendError(reply, error, 'CONTENT_PDF_IMPORT_FAILED');
    }
  });

  app.post('/v1/campaigns/:campaignId/content/import-foundry', { bodyLimit: CONTENT_IMPORT_BODY_LIMIT }, async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await contentImportService.importFoundry({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        fileName: request.body?.fileName,
        journal: request.body?.journal,
        title: request.body?.title,
        targetLanguage: request.body?.targetLanguage,
        localize: request.body?.localize
      });
    } catch (error) {
      return sendError(reply, error, 'CONTENT_FOUNDRY_IMPORT_FAILED');
    }
  });

  app.post('/v1/campaigns/:campaignId/content/:adventureId/review', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await contentImportService.review({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        adventureId: request.params.adventureId,
        queue: request.body?.queue,
        decisions: request.body?.decisions ?? request.body?.decision
      });
    } catch (error) {
      return sendError(reply, error, 'CONTENT_REVIEW_FAILED');
    }
  });

  app.post('/v1/campaigns/:campaignId/content/:adventureId/assets/:imageId/promote-scene', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await contentImportService.promoteMapToScene({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        adventureId: request.params.adventureId,
        imageId: request.params.imageId,
        name: request.body?.name,
        description: request.body?.description,
        gridSize: request.body?.gridSize
      });
    } catch (error) {
      return sendError(reply, error, 'CONTENT_MAP_PROMOTION_FAILED');
    }
  });

  app.delete('/v1/campaigns/:campaignId/content/:adventureId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await contentImportService.remove({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        adventureId: request.params.adventureId
      });
    } catch (error) {
      return sendError(reply, error, 'CONTENT_REMOVE_FAILED');
    }
  });
}
