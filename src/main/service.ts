import { Runtime } from "../core/runtime";
import { MediaPool } from "../core/media-pool";
import path from "node:path";
const parent = (process as any).parentPort;
const send = (message: any) =>
  parent
    ? parent.postMessage(message)
    : process.send
      ? process.send(message)
      : undefined;
let runtime: Runtime;
const incoming = async (message: any) => {
  try {
    if (message.type === "init") {
      runtime = await new Runtime(
        message.root,
        (type, data) => send({ type: "event", event: { type, data } }),
        new MediaPool(path.join(__dirname, "media-worker.cjs")),
        message.generationAccess,
      ).init();
      send({ type: "ready" });
    } else if (message.type === "generation.config") {
      runtime.generationAccess = message.access;
      runtime.generation.configure(message.access);
    } else if (message.type === "shutdown") {
      await runtime.shutdown();
      send({ type: "closed" });
      process.exit(0);
    } else if (message.type === "request") {
      const result = await runtime.handle(message.method, message.input);
      send({ type: "response", id: message.id, result });
    }
  } catch (error: any) {
    send({
      type: message.type === "init" ? "init-error" : "response",
      id: message.id,
      error: {
        code: error.code ?? "OPERATION",
        message: error.message,
        retryable: error.retryable ?? false,
      },
    });
  }
};
if (parent) parent.on("message", (event: any) => void incoming(event.data));
else process.on("message", (m) => void incoming(m));
