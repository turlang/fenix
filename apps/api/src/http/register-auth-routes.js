export function registerAuthRoutes(app, { authService }) {
  if (!app || !authService) throw new TypeError('app e authService são obrigatórios.');
  app.get('/v1/auth/status', async () => ({ bootstrapRequired: !authService.hasUsers() }));
}
