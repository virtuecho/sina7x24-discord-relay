export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === '/healthz') {
      return Response.json({
        ok: true,
        service: 'sina7x24-discord-relay'
      });
    }

    return Response.json({
      ok: true,
      service: 'sina7x24-discord-relay',
      message: 'Worker bootstrap is ready.'
    });
  }
};
