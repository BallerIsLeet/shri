// Healthz — public (basic-auth middleware excludes /api/healthz). Used by
// Railway for service health checks. Keep it dumb so misconfigured envs don't
// trigger a healthcheck flap.

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return new Response("ok", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
