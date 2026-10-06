import BetterSqlite from "better-sqlite3";
import { DatabaseSync, backup } from "node:sqlite";

// Both drivers write the same SQLite/WAL format. The built-in driver avoids a
// local compiler requirement when the Electron ABI has no available prebuild.
export function openDatabase(filename: string): any {
  try {
    return new BetterSqlite(filename);
  } catch (error: any) {
    if (
      !/bindings|NODE_MODULE_VERSION|Could not locate|not a valid Win32|Cannot find module|compiled against/i.test(
        error.message,
      )
    )
      throw error;
    const db = new DatabaseSync(filename);
    let depth = 0,
      sequence = 0;
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => db.prepare(sql),
      close: () => db.close(),
      pragma: (value: string) => db.exec(`PRAGMA ${value}`),
      transaction:
        (fn: (...args: any[]) => any) =>
        (...args: any[]) => {
          const nested = depth > 0,
            savepoint = `workshop_${++sequence}`;
          db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
          depth++;
          try {
            const result = fn(...args);
            db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
            return result;
          } catch (e) {
            if (nested) {
              db.exec(`ROLLBACK TO ${savepoint}`);
              db.exec(`RELEASE ${savepoint}`);
            } else db.exec("ROLLBACK");
            throw e;
          } finally {
            depth--;
          }
        },
      backup: (target: string) => backup(db, target),
    };
  }
}
