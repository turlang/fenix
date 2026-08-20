import { requireAuthenticatedRequest } from './register-auth-routes.js';

const PDF_IMPORT_BODY_LIMIT = 36 * 1024 * 1024;

function sendError(reply, error, fallback = 'CONTENT_REQUEST_FAILED') {
  const status = Number(error?.statusCode) || 400;
  return reply.code(status).send({
    code: error?.code || fallback,
    message: error?.message || 'Falha ao processar conteúdo.'
  });
}

export function registerContentRoutes(app, { authService, contentImportService }) {
  if (!app || !authService || !contentImportService) throw new TypeError('app, authService e contentImportService são obrigatórios.');

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

  app.post('/v1/campaigns/:campaignId/content/import-pdf', { bodyLimit: PDF_IMPORT_BODY_LIMIT }, async (request, reply) => {
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
        ocrMinimumReviewConfidence: request.body?.ocrMinimumReviewConfidence
      });
    } catch (error) {
      return sendError(reply, error, 'CONTENT_PDF_IMPORT_FAILED');
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
