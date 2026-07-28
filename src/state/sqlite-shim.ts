/**
 * better-sqlite3-compatible shim for Termux.
 *
 * Termux has no C/C++ toolchain to build the native better-sqlite3 addon,
 * so this shim backs the same synchronous API with one of two pure-JS /
 * built-in engines:
 *
 *   1. node:sqlite (DatabaseSync) — built into Node.js >= 22.5, no native
 *      compilation, fully synchronous, on-disk persistence. Preferred.
 *   2. sql.js (pure WebAssembly SQLite) — fallback for Node 20/21 where
 *      node:sqlite is unavailable. In-memory with on-write persistence.
 *
 * Implemented surface (everything the automaton codebase uses):
 *   - new Database(path)
 *   - db.prepare(sql) -> Statement { get, all, run, bind, pluck, raw, expand, source, database }
 *   - db.exec(sql)
 *   - db.pragma(str) -> rows
 *   - db.transaction(fn) -> wrapped fn (BEGIN/COMMIT/ROLLBACK, savepoint-nested)
 *   - db.close()
 *   - Statement.run() returns { changes, lastInsertRowid }
 *
 * Not implemented (not used by the codebase): loadExtension, function,
 * aggregate, backup, serialize/deserialize, iterate.
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";

// In an ESM package ("type": "module"), top-level require() is unavailable.
// createRequire gives us a synchronous require for builtin modules like
// node:sqlite and for locating sql.js's wasm file.
const require = createRequire(import.meta.url);

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): RunResult;
  bind(...params: unknown[]): this;
  pluck(enable?: boolean): this;
  raw(enable?: boolean): this;
  expand(enable?: boolean): this;
  readonly source: string;
  readonly database: Database;
}

// ─── better-sqlite3 namespace compatibility ────────────────────────
// The upstream codebase uses `BetterSqlite3.Database` and `Database.Database`
// as type references (better-sqlite3 exports its Database class both as the
// default export and as a namespace containing the Database and Statement
// types). Merge a namespace of the same name so those qualified references
// resolve against this shim.
export interface DatabaseInstance {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(input: string): unknown[];
  transaction<TFn extends (...args: never[]) => unknown>(fn: TFn): TFn;
  close(): void;
  readonly open: boolean;
  readonly inTransaction: boolean;
  readonly readonly: boolean;
  readonly name: string;
}

export interface StatementInstance extends Statement {}

// ─── Engine detection ──────────────────────────────────────────────

type NodeSqliteModule = typeof import("node:sqlite");
let nodeSqlite: NodeSqliteModule | null = null;
let nodeSqliteChecked = false;

function getNodeSqlite(): NodeSqliteModule | null {
  if (nodeSqliteChecked) return nodeSqlite;
  nodeSqliteChecked = true;
  try {
    // `node:sqlite` is available on Node >= 22.5 (flag-free since 22.13).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("node:sqlite") as NodeSqliteModule;
    if (mod && mod.DatabaseSync) {
      nodeSqlite = mod;
    }
  } catch {
    nodeSqlite = null;
  }
  return nodeSqlite;
}

let SqlJsStatic: any = null;
async function getSqlJs(): Promise<any> {
  if (SqlJsStatic) return SqlJsStatic;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const initSqlJs = require("sql.js").default;
  SqlJsStatic = await initSqlJs({
    locateFile: (file: string) => {
      try {
        const candidate = path.join(
          path.dirname(require.resolve("sql.js/package.json")),
          "dist",
          file,
        );
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        /* ignore */
      }
      return `https://sql.js.org/dist/${file}`;
    },
  });
  return SqlJsStatic;
}

// sql.js needs async init; we cache per-path instances and track readiness.
const sqlJsCache = new Map<string, any>();
const sqlJsReady = new Map<string, Promise<void>>();

// ─── Helpers ───────────────────────────────────────────────────────

function toBindValue(v: unknown): unknown {
  if (v === undefined) return null;
  return v;
}

class NodeSqliteStatement implements Statement {
  readonly source: string;
  readonly database: Database;
  private stmt: any;
  private pluckOn = false;

  constructor(db: Database, sql: string, underlying: any) {
    this.database = db;
    this.source = sql;
    this.stmt = underlying;
  }

  get(...params: unknown[]): unknown {
    if (this.pluckOn) {
      const rows = this.all(...params);
      return rows.length ? Object.values(rows[0] as Record<string, unknown>)[0] : undefined;
    }
    return this.stmt.get(...params.map(toBindValue));
  }

  all(...params: unknown[]): unknown[] {
    const rows = this.stmt.all(...params.map(toBindValue)) as unknown[];
    if (this.pluckOn) {
      return rows.map((r) => Object.values(r as Record<string, unknown>)[0]);
    }
    return rows;
  }

  run(...params: unknown[]): RunResult {
    const r = this.stmt.run(...params.map(toBindValue));
    return {
      changes: r.changes ?? 0,
      lastInsertRowid: r.lastInsertRowid ?? 0,
    };
  }

  bind(..._params: unknown[]): this {
    // better-sqlite3 binds at call time; bind() is a no-op-style stub here.
    return this;
  }
  pluck(enable = true): this {
    this.pluckOn = enable;
    return this;
  }
  raw(_enable = true): this {
    return this;
  }
  expand(_enable = true): this {
    return this;
  }
}

// ─── Database ──────────────────────────────────────────────────────

export class Database {
  private engine: "node" | "sqljs";
  private nodeDb: any = null;
  private sqljsDb: any = null;
  private dbPath: string;
  private closed = false;
  private txDepth = 0;

  constructor(dbPath: string, _options?: Record<string, unknown>) {
    this.dbPath = dbPath;
    const nodeMod = getNodeSqlite();
    if (nodeMod) {
      this.engine = "node";
      const dir = path.dirname(dbPath);
      if (dbPath !== ":memory:" && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      this.nodeDb = new nodeMod.DatabaseSync(dbPath);
    } else {
      this.engine = "sqljs";
      this.sqljsDb = sqlJsCache.get(dbPath) ?? null;
      if (!sqlJsReady.has(dbPath)) {
        sqlJsReady.set(
          dbPath,
          (async () => {
            const sql = await getSqlJs();
            let db: any;
            if (dbPath !== ":memory:" && fs.existsSync(dbPath)) {
              const buf = fs.readFileSync(dbPath);
              const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
              db = new sql.Database(bytes);
            } else {
              db = new sql.Database();
            }
            sqlJsCache.set(dbPath, db);
            this.sqljsDb = db;
          })(),
        );
      }
    }
  }

  /** Await once before first synchronous use (only needed for sql.js engine). */
  static async ready(db: Database): Promise<void> {
    if (db.engine === "sqljs") {
      const p = sqlJsReady.get(db.dbPath);
      if (p) await p;
    }
  }

  private get active(): any {
    return this.engine === "node" ? this.nodeDb : this.sqljsDb;
  }

  exec(sql: string): void {
    this.active.exec(sql);
    if (this.engine === "sqljs") this.persistSqljs();
  }

  prepare(sql: string): Statement {
    if (this.engine === "node") {
      const underlying = this.nodeDb.prepare(sql);
      return new NodeSqliteStatement(this, sql, underlying);
    }
    const self = this;
    let pluckOn = false;
    return {
      source: sql,
      database: self,
      get(...params: unknown[]) {
        const stmt = self.sqljsDb.prepare(sql);
        try {
          stmt.bind(params.map(toBindValue) as never);
          if (stmt.step()) {
            const row = stmt.getAs(null as never) as Record<string, unknown>;
            if (pluckOn) return Object.values(row)[0];
            return row;
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },
      all(...params: unknown[]) {
        const stmt = self.sqljsDb.prepare(sql);
        try {
          stmt.bind(params.map(toBindValue) as never);
          const out: unknown[] = [];
          while (stmt.step()) {
            const row = stmt.getAs(null as never) as Record<string, unknown>;
            out.push(pluckOn ? Object.values(row)[0] : row);
          }
          return out;
        } finally {
          stmt.free();
        }
      },
      run(...params: unknown[]): RunResult {
        const stmt = self.sqljsDb.prepare(sql);
        try {
          stmt.bind(params.map(toBindValue) as never);
          stmt.step();
          const changes = self.sqljsDb.getRowsModified();
          const lastInsertRowid = (self.sqljsDb as any).lastInsertRowid ?? 0;
          self.persistSqljs();
          return { changes, lastInsertRowid };
        } finally {
          stmt.free();
        }
      },
      bind(..._p: unknown[]) {
        return this;
      },
      pluck(enable = true) {
        pluckOn = enable;
        return this;
      },
      raw(_e = true) {
        return this;
      },
      expand(_e = true) {
        return this;
      },
    };
  }

  pragma(input: string): unknown[] {
    try {
      if (this.engine === "node") {
        this.nodeDb.exec(`PRAGMA ${input};`);
        const stmt = this.nodeDb.prepare(`PRAGMA ${input};`);
        try {
          return (stmt as any).all() as unknown[];
        } finally {
          (stmt as any).finalize?.();
        }
      } else {
        this.sqljsDb.exec(`PRAGMA ${input};`);
        const stmt = this.sqljsDb.prepare(`PRAGMA ${input};`);
        const out: unknown[] = [];
        while (stmt.step()) out.push(stmt.getAs(null as never) as Record<string, unknown>);
        stmt.free();
        return out as never;
      }
    } catch {
      const lower = input.toLowerCase().trim();
      if (lower.startsWith("journal_mode")) return [{ journal_mode: "memory" }];
      return [];
    }
  }

  transaction<TFn extends (...args: never[]) => unknown>(fn: TFn): TFn {
    const self = this;
    return ((...args: never[]) => {
      const nested = self.txDepth > 0;
      let sp = "";
      if (nested) {
        sp = `automaton_sp_${self.txDepth}_${Date.now()}`;
        self.exec(`SAVEPOINT ${sp};`);
      } else {
        self.exec("BEGIN;");
      }
      self.txDepth++;
      try {
        const result = fn(...args);
        if (nested) {
          self.exec(`RELEASE SAVEPOINT ${sp};`);
        } else {
          self.exec("COMMIT;");
        }
        self.txDepth--;
        return result;
      } catch (err) {
        if (nested) {
          self.exec(`ROLLBACK TO SAVEPOINT ${sp};`);
          self.exec(`RELEASE SAVEPOINT ${sp};`);
        } else {
          self.exec("ROLLBACK;");
        }
        self.txDepth--;
        throw err;
      }
    }) as TFn;
  }

  close(): void {
    if (this.closed) return;
    if (this.engine === "sqljs") this.persistSqljsNow();
    try {
      this.active.close();
    } catch {
      /* ignore */
    }
    if (this.engine === "sqljs") sqlJsCache.delete(this.dbPath);
    this.closed = true;
  }

  // ─── sql.js persistence ──────────────────────────────────────────
  private persistScheduled = false;
  private persistTimer: NodeJS.Timeout | null = null;

  private persistSqljs(): void {
    if (this.engine !== "sqljs") return;
    if (this.dbPath === ":memory:") return;
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistScheduled = false;
      this.persistTimer = null;
      this.persistSqljsNow();
    }, 100);
  }

  private persistSqljsNow(): void {
    if (!this.sqljsDb) return;
    try {
      const data = this.sqljsDb.export() as Uint8Array;
      const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.dbPath, buf);
    } catch {
      /* ignore persistence errors */
    }
  }
}

export default Database;

// Namespace merge: mirrors better-sqlite3's exported type surface so that
// `Database.Database`, `Database.Statement`, and `BetterSqlite3.Database`
// resolve when code imports this shim under the `better-sqlite3` specifier.
// `Database.Database` is the instance type of the Database class itself.
export namespace Database {
  // The class instance type — same shape callers got from better-sqlite3.
  export type Database = InstanceType<typeof Database>;
  export type Statement = StatementInstance;
}
