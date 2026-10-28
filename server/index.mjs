import express from 'express';
import path from 'node:path';
import { createApp } from './app.mjs';
const { app, db } = await createApp();
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve('dist'), { index: false, maxAge: '1h' }));
  app.get('/{*path}', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.resolve('dist/index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, '0.0.0.0', () => console.log(`奇遇 DDL listening on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(async () => {
      await db.close();
      process.exit(0);
    }),
  );
