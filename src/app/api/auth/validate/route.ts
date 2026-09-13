import { classifyApiKey } from "@/lib/auth";
import { useLogger, withEvlog } from "@/lib/evlog";
import { identifyEvlogUser } from "@/lib/evlog-auth";

export const POST = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "auth" });

  await identifyEvlogUser(request);

  let key: unknown;
  try {
    const body = (await request.json()) as { key?: unknown };
    key = body?.key;
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  if (typeof key !== "string" || classifyApiKey(key) === "invalid") {
    return Response.json({ ok: false, error: "invalid_key" }, { status: 401 });
  }

  const demo = classifyApiKey(key) === "demo";
  logger.set({ demo, audit: "api_key_authenticated" });
  return Response.json({ ok: true, demo });
});
