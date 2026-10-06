import { fork, type ChildProcess } from "node:child_process";
import type { FileRecord } from "../shared/types";
interface Request {
  filename: string;
  file: FileRecord;
  cache: string;
  resolve: (result: any) => void;
}
export class MediaPool {
  private queue: Request[] = [];
  private workers: {
    child: ChildProcess;
    current?: Request;
    timer?: ReturnType<typeof setTimeout>;
  }[] = [];
  private closing = false;
  constructor(private workerFile: string) {}
  inspect(filename: string, file: FileRecord, cache: string) {
    return new Promise<any>((resolve) => {
      this.queue.push({ filename, file, cache, resolve });
      this.pump();
    });
  }
  private pump() {
    if (this.closing) return;
    while (this.queue.length) {
      let worker = this.workers.find((w) => !w.current);
      if (!worker && this.workers.length < 2) {
        const child = fork(this.workerFile, [], {
          execPath: process.execPath,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          execArgv: ["--max-old-space-size=512"],
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        });
        child.stderr?.resume();
        worker = { child };
        this.workers.push(worker);
        const slot = worker;
        child.on("message", (result: any) => {
          if (!slot.current) return;
          clearTimeout(slot.timer);
          slot.current.resolve(result);
          slot.current = undefined;
          this.pump();
        });
        child.on("error", () => this.failed(slot, "解析进程无法启动"));
        child.on("exit", () =>
          this.failed(slot, "解析进程异常退出，原件已保留"),
        );
      }
      if (!worker) break;
      const request = this.queue.shift()!;
      worker.current = request;
      const slot = worker;
      worker.timer = setTimeout(() => {
        this.failed(slot, "解析超时（40 秒），原件已保留");
        slot.child.kill();
      }, 40000);
      worker.child.send({
        filename: request.filename,
        file: request.file,
        cache: request.cache,
      });
    }
  }
  private failed(worker: (typeof this.workers)[number], message: string) {
    if (!this.workers.includes(worker)) return;
    clearTimeout(worker.timer);
    worker.current?.resolve({ metadata: { previewError: message } });
    worker.current = undefined;
    this.workers = this.workers.filter((w) => w !== worker);
    worker.child.kill();
    this.pump();
  }
  close() {
    this.closing = true;
    for (const worker of this.workers) {
      clearTimeout(worker.timer);
      worker.current?.resolve({ metadata: { previewError: "解析服务已关闭" } });
      worker.child.kill();
    }
    this.workers = [];
  }
}
