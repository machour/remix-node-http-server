import type http from "http";
import { PassThrough } from "stream";
import type {
  AppLoadContext,
  ServerBuild,
  ServerPlatform,
} from "@remix-run/server-runtime";
import { createRequestHandler as createRemixRequestHandler } from "@remix-run/server-runtime";
import type {
  RequestInit as NodeRequestInit,
  Response as NodeResponse,
} from "@remix-run/node";
import {
  Headers as NodeHeaders,
  Request as NodeRequest,
  formatServerError,
} from "@remix-run/node";

/**
 * A function that returns the value to use as `context` in route `loader` and
 * `action` functions.
 *
 * You can think of this as an escape hatch that allows you to pass
 * environment/platform-specific values through to your loader/action, such as
 * values that are generated by Express middleware like `req.session`.
 */
export interface GetLoadContextFunction {
  (req: http.IncomingMessage, res: http.ServerResponse): AppLoadContext;
}

export type RequestHandler = ReturnType<typeof createRequestHandler>;

/**
 * Returns a request handler for Express that serves the response using Remix.
 */
export function createRequestHandler({
  build,
  getLoadContext,
  mode = process.env.NODE_ENV,
}: {
  build: ServerBuild;
  getLoadContext?: GetLoadContextFunction;
  mode?: string;
}) {
  let platform: ServerPlatform = { formatServerError };
  let handleRequest = createRemixRequestHandler(build, platform, mode);

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    let request = createRemixRequest(req);
    let loadContext =
      typeof getLoadContext === "function"
        ? getLoadContext(req, res)
        : undefined;

    let response = (await handleRequest(
      request as unknown as http.IncomingMessage,
      loadContext
    )) as unknown as NodeResponse;

    sendRemixResponse(res, response);
  };
}

function createRemixHeader(
  requestHeaders: http.IncomingHttpHeaders
): NodeHeaders {
  let headers = new NodeHeaders();

  for (let [key, values] of Object.entries(requestHeaders)) {
    if (values) {
      if (Array.isArray(values)) {
        for (let value of values) {
          headers.append(key, value);
        }
      } else {
        headers.set(key, values);
      }
    }
  }

  return headers;
}

export function createRemixRequest(req: http.IncomingMessage): NodeRequest {
  let protocol = "http";
  let host = req.headers.host;
  let url = new URL(req.url!, `${protocol}://${host}`);

  let init: NodeRequestInit = {
    method: req.method,
    headers: createRemixHeader(req.headers),
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.pipe(new PassThrough({ highWaterMark: 16384 }));
  }

  return new NodeRequest(url.toString(), init);
}

function sendRemixResponse(res: http.ServerResponse, response: NodeResponse) {
  res.statusCode = response.status;

  for (let [key, values] of Object.entries(response.headers.raw())) {
    res.setHeader(key, values);
  }

  if (Buffer.isBuffer(response.body)) {
    res.end(response.body);
  } else if (response.body?.pipe) {
    response.body.pipe(res);
  } else {
    res.end();
  }
}