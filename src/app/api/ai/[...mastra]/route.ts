import { createNextRouteHandler } from "@mastra/next";
import type { NextRequest } from "next/server";
import { useLogger, withEvlog } from "@/lib/evlog";
import { identifyEvlogUser } from "@/lib/evlog-auth";
import { authenticate, requireWriteAccess } from "@/lib/route-auth";
import { mastra } from "@/mastra";

const handlers = createNextRouteHandler({ mastra, prefix: "/api/ai" });

function wrap(handler: (request: NextRequest) => Response | Promise<Response>) {
  return withEvlog(async (request: NextRequest) => {
    await identifyEvlogUser(request); // attaches user to the wide event
    useLogger().set({ integration: "mastra" });

    const auth =
      request.method === "GET" || request.method === "HEAD"
        ? authenticate(request)
        : requireWriteAccess(request);
    if (!auth.ok) {
      return auth.response;
    }
    return handler(request);
  });
}

export const GET = wrap(handlers.GET);
export const POST = wrap(handlers.POST);
export const PUT = wrap(handlers.PUT);
export const DELETE = wrap(handlers.DELETE);
export const PATCH = wrap(handlers.PATCH);
export const OPTIONS = wrap(handlers.OPTIONS);
export const HEAD = wrap(handlers.HEAD);
