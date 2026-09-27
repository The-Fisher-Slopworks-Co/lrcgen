import path from "node:path";
import type { BunRequest, Server } from "bun";
import type { ApiError } from "../shared/api";

export type Handler = (req: BunRequest<string>, server: Server<undefined>) => Response | Promise<Response>;
export type Method = "GET" | "POST" | "PUT" | "DELETE";
export type RouteTable = Record<string, Partial<Record<Method, Handler>>>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message);

export function errorResponse(status: number, message: string): Response {
  const body: ApiError = { error: message };
  return Response.json(body, { status });
}

export function toErrorResponse(e: unknown): Response {
  if (e instanceof HttpError) return errorResponse(e.status, e.message);
  return errorResponse(500, e instanceof Error ? e.message : String(e));
}

export function query(req: Request, name: string): string {
  const value = new URL(req.url).searchParams.get(name);
  if (value === null || value === "") throw badRequest(`Missing "${name}"`);
  return value;
}

export function optionalQuery(req: Request, name: string): string | undefined {
  return new URL(req.url).searchParams.get(name) || undefined;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("The request body is not valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest("Expected a JSON object");
  return body as Record<string, unknown>;
}

/** A path sent by the browser: must be absolute; returned normalised. */
export function clientPath(value: unknown, what = "path"): string {
  if (typeof value !== "string" || value === "") throw badRequest(`Missing "${what}"`);
  if (value.includes("\0") || !path.isAbsolute(value)) throw badRequest(`"${what}" must be an absolute path`);
  return path.resolve(value);
}
