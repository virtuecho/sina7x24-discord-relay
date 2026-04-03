import { ensureRelayRuntimeReady, readRuntimeConfig } from './config.js';
import {
  HttpError,
  assertAdminAuthorized,
  createJsonResponse,
  createMethodNotAllowedResponse,
  createNotFoundResponse,
  createErrorResponse
} from './http.js';
import { runRelaySync } from './relay.js';
import { createRelayStore } from './store.js';

function createPublicStatus(config, env) {
  return {
    ok: true,
    service: config.serviceName,
    runtime: {
      hasD1Binding: Boolean(env.DB),
      hasDiscordWebhookSecret: Boolean(config.discordWebhookUrl),
      hasAdminApiToken: Boolean(config.adminApiToken),
      allowUnauthenticatedAdmin: config.allowUnauthenticatedAdmin,
      zhiboId: config.zhiboId,
      pageSize: config.pageSize,
      runLockTtlMs: config.runLockTtlMs,
      relayItemRetentionDays: config.relayItemRetentionDays
    }
  };
}

async function handleStatus(request, env, config) {
  assertAdminAuthorized(request, config);
  ensureRelayRuntimeReady(env, config);

  const store = createRelayStore(env.DB);
  const snapshot = await store.getStatusSnapshot();

  return createJsonResponse({
    ...createPublicStatus(config, env),
    state: snapshot
  });
}

async function handleManualRun(request, env, config) {
  assertAdminAuthorized(request, config);
  ensureRelayRuntimeReady(env, config);

  const summary = await runRelaySync(env, config, {
    triggerType: 'manual'
  });

  return createJsonResponse({
    ok: true,
    service: config.serviceName,
    summary
  });
}

export default {
  async fetch(request, env) {
    const config = readRuntimeConfig(env);
    const { pathname } = new URL(request.url);

    try {
      if (pathname === '/') {
        return createJsonResponse({
          ...createPublicStatus(config, env),
          message: 'Standalone Worker for the Sina 7x24 Discord relay.',
          endpoints: [
            'GET /healthz',
            'GET /api/status',
            'POST /api/run'
          ]
        });
      }

      if (pathname === '/healthz') {
        return createJsonResponse({
          ...createPublicStatus(config, env)
        });
      }

      if (pathname === '/api/status') {
        if (request.method !== 'GET') {
          return createMethodNotAllowedResponse(['GET']);
        }

        return await handleStatus(request, env, config);
      }

      if (pathname === '/api/run') {
        if (request.method !== 'POST') {
          return createMethodNotAllowedResponse(['POST']);
        }

        return await handleManualRun(request, env, config);
      }

      return createNotFoundResponse();
    } catch (error) {
      return createErrorResponse(error);
    }
  },

  async scheduled(controller, env, ctx) {
    const config = readRuntimeConfig(env);

    ctx.waitUntil(
      (async () => {
        try {
          ensureRelayRuntimeReady(env, config);
          await runRelaySync(env, config, {
            triggerType: `cron:${controller.cron || 'scheduled'}`
          });
        } catch (error) {
          const payload = error instanceof HttpError
            ? { code: error.code, message: error.message, details: error.details ?? null }
            : { message: error instanceof Error ? error.message : String(error) };

          console.error('Scheduled relay run failed:', payload);
        }
      })()
    );
  }
};
