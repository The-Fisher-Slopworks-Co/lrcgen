import type { JobEvent, JobKind } from "../../shared/api";
import type { ServerContext } from "../context";
import { badRequest, clientPath, notFound, optionalQuery, readJson, type RouteTable } from "../http";
import { requireAudioFile } from "../audio-files";

const KINDS: JobKind[] = ["transcribe", "separate"];

function jobEvents(ctx: ServerContext, id: string, signal: AbortSignal): Response {
  const initial = ctx.jobs.get(id);
  if (!initial) throw notFound("No such job");
  const encoder = new TextEncoder();
  let close = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      const sendEvent = (event: JobEvent) => send(`data: ${JSON.stringify(event)}\n\n`);
      const heartbeat = setInterval(() => send(": ping\n\n"), ctx.heartbeatMs);
      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {}
      };

      sendEvent({ type: "state", job: initial });
      if (initial.status !== "running") {
        sendEvent({ type: "done", job: initial });
        close();
        return;
      }
      unsubscribe = ctx.jobs.subscribe(id, (event) => {
        sendEvent(event);
        if (event.type === "done") close();
      });
    },
    cancel() {
      close();
    },
  });
  signal.addEventListener("abort", () => close());

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

export function jobRoutes(ctx: ServerContext): RouteTable {
  return {
    "/api/jobs": {
      GET: async (req) => {
        const audioPath = optionalQuery(req, "audioPath");
        return Response.json(ctx.jobs.list(audioPath === undefined ? undefined : clientPath(audioPath, "audioPath")));
      },
      POST: async (req) => {
        const body = await readJson(req);
        if (!KINDS.includes(body.kind as JobKind)) throw badRequest(`"kind" must be one of ${KINDS.join(", ")}`);
        const audioPath = clientPath(body.audioPath, "audioPath");
        await requireAudioFile(audioPath);
        return Response.json(ctx.jobs.start(body.kind as JobKind, audioPath));
      },
    },
    "/api/jobs/:id": {
      DELETE: async (req) => {
        const job = ctx.jobs.cancel(req.params.id!);
        if (!job) throw notFound("No such job");
        return Response.json(job);
      },
    },
    "/api/jobs/:id/events": {
      GET: async (req, server) => {
        server.timeout(req, 0);
        return jobEvents(ctx, req.params.id!, req.signal);
      },
    },
    "/api/transcripts/:draftId": {
      GET: async (req) => {
        const transcript = await ctx.registry.transcriptStore.get(req.params.draftId!);
        if (!transcript) throw notFound("No transcription for this draft");
        return Response.json(transcript);
      },
    },
  };
}
