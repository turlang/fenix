import { actionSchema, objectBodySchema, roomEntrySchema } from './session-schemas.js';

export function registerSessionRoutes(app, { controller }) {
  if (!app) throw new TypeError('app é obrigatório.');
  if (!controller) throw new TypeError('controller é obrigatório.');

  app.post('/v1/session/start', { schema: objectBodySchema }, controller.start);
  app.post('/v1/session/action', { schema: actionSchema }, controller.action);
  app.post('/v1/session/room-entry', { schema: roomEntrySchema }, controller.roomEntry);
  app.post('/v1/session/end', controller.end);
  app.get('/v1/session/status', controller.status);
}
