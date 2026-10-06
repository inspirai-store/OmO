import path from "node:path";
import { readJSON } from "../core/files";
import { rebuildLibrary } from "../core/recovery";
async function main() {
  const [source, target] = process.argv.slice(2);
  if (!source || !target)
    throw new Error("使用：recover.cjs 原素材库 新的空目录");
  const lock = await readJSON<any>(path.join(source, ".write.lock"), null);
  if (lock) {
    let alive = false;
    try {
      process.kill(lock.pid, 0);
      alive = true;
    } catch {}
    if (alive) throw new Error("请先关闭正在使用原库的工坊");
  }
  console.log(JSON.stringify(await rebuildLibrary(source, target), null, 2));
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
