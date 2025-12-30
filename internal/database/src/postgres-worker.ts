// This is fully vibe-coded and quite honestly,
// I have zero clue how it works - but it works.
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as net from "net";
import { join } from "path";
import {
  BackendMessageCode,
  FrontendMessageCode,
  getMessages,
  PostgresConnection,
} from "pg-gateway";
import { fromNodeSocket } from "pg-gateway/node";
import type { PostgresOptions } from "./test";

type Session = {
  id: string;
  inTxn: boolean;
  watchdog?: NodeJS.Timeout | null;
  // per-socket emulation for unnamed objects
  unnamedStmt?: string;
  unnamedPortal?: string;
  cS: number; // stmt counter
  cP: number; // portal counter
};

const SID_DELIM = "\x1F";
const OWNER_WATCHDOG_MS = 3000;

const td = new TextDecoder();
const te = new TextEncoder();

self.onmessage = async (e) => {
  const opts = e.data as PostgresOptions;
  const password = opts.password ?? "password";

  const db = new PGlite(opts.storage ?? "memory://", {
    username: "postgres",
    debug: 0,
    extensions: { vector, uuid_ossp },
  });
  await db.waitReady;
  await db.exec("SET client_min_messages TO ERROR;");
  await db.exec("SET log_min_messages TO ERROR;");
  await migrate(drizzle(db), {
    migrationsFolder: join(__dirname, "..", "migrations"),
  });

  type Task = {
    socket: net.Socket;
    data: Uint8Array;
    resolve: (v: Uint8Array) => void;
    reject: (e: unknown) => void;
  };
  const taskQueue: Task[] = [];
  let processing = false;

  let owner: net.Socket | null = null;
  const sessions = new Map<net.Socket, Session>();
  const patchBySocket = new Map<net.Socket, PGliteExtendedQueryPatch>();

  // --- bin helpers ---
  const dv32 = (b: Uint8Array, o: number) =>
    ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const sv32 = (b: Uint8Array, o: number) =>
    (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  const wr32 = (n: number) =>
    new Uint8Array([
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    ]);
  const wr16 = (n: number) => new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
  const zero = () => new Uint8Array([0]);
  const concat = (...parts: Uint8Array[]) => {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const withLength = (header: Uint8Array, body: Uint8Array) => {
    const len = body.length + 4;
    header[1] = (len >>> 24) & 0xff;
    header[2] = (len >>> 16) & 0xff;
    header[3] = (len >>> 8) & 0xff;
    header[4] = len & 0xff;
    return concat(header, body);
  };
  const readCString = (buf: Uint8Array, off: number) => {
    let i = off;
    while (i < buf.length && buf[i] !== 0) i++;
    const str = td.decode(buf.subarray(off, i));
    return { str, next: i + 1 };
  };

  // --- simple SQL detection ---
  const stripSqlLeadingNoise = (sql: string) => {
    let s = sql.trimStart();
    for (;;) {
      if (s.startsWith("/*")) {
        const end = s.indexOf("*/");
        if (end === -1) break;
        s = s.slice(end + 2).trimStart();
        continue;
      }
      if (s.startsWith("--")) {
        const nl = s.indexOf("\n");
        if (nl === -1) return "";
        s = s.slice(nl + 1).trimStart();
        continue;
      }
      break;
    }
    return s;
  };
  const isBeginLike = (sql: string) => {
    const s = stripSqlLeadingNoise(sql).toLowerCase();
    return s.startsWith("begin") || s.startsWith("start transaction");
  };
  const isCommitOrRollback = (sql: string) => {
    const s = stripSqlLeadingNoise(sql).toLowerCase();
    return (
      s.startsWith("commit") || s.startsWith("end") || s.startsWith("rollback")
    );
  };

  // --- namespacing / per-socket unnamed emulation ---
  const ns = (sess: Session, name: string) =>
    name.length === 0 ? "" : sess.id + SID_DELIM + name;
  const nextStmtName = (sess: Session) => `${sess.id}${SID_DELIM}S${++sess.cS}`;
  const nextPortalName = (sess: Session) =>
    `${sess.id}${SID_DELIM}P${++sess.cP}`;

  const rewriteOneMessage = (sess: Session, msg: Uint8Array): Uint8Array => {
    const tag = msg[0];
    const len = dv32(msg, 1);
    const body = msg.subarray(5, 1 + len);
    const header = new Uint8Array([tag, ...wr32(0)]);

    switch (tag) {
      case FrontendMessageCode.Parse: {
        let off = 0;
        const name1 = readCString(body, off);
        off = name1.next;
        const query1 = readCString(body, off);
        off = query1.next;
        const nParams = (body[off] << 8) | body[off + 1];
        off += 2;
        const paramBytes = body.subarray(off, off + nParams * 4);

        let outName: string;
        if (name1.str.length === 0) {
          outName = nextStmtName(sess);
          sess.unnamedStmt = outName;
        } else {
          outName = ns(sess, name1.str);
        }

        const outBody = concat(
          te.encode(outName),
          zero(),
          te.encode(query1.str),
          zero(),
          wr16(nParams),
          paramBytes
        );
        return withLength(header, outBody);
      }

      case FrontendMessageCode.Bind: {
        let off = 0;
        const portal = readCString(body, off);
        off = portal.next;
        const stmt = readCString(body, off);
        off = stmt.next;

        const nFmt = (body[off] << 8) | body[off + 1];
        off += 2;
        const fmtBytes = body.subarray(off, off + nFmt * 2);
        off += nFmt * 2;

        const nParams = (body[off] << 8) | body[off + 1];
        off += 2;
        const paramsStart = off;
        for (let i = 0; i < nParams; i++) {
          const l = sv32(body, off);
          off += 4;
          if (l >= 0) off += l;
        }
        const paramVals = body.subarray(paramsStart, off);

        const nResFmt = (body[off] << 8) | body[off + 1];
        off += 2;
        const resFmtBytes = body.subarray(off, off + nResFmt * 2);

        // portal name
        let outPortal: string;
        if (portal.str.length === 0) {
          outPortal = nextPortalName(sess);
          sess.unnamedPortal = outPortal;
        } else {
          outPortal = ns(sess, portal.str);
        }

        // statement name
        let outStmt: string;
        if (stmt.str.length === 0) {
          // Bind to most recent unnamed stmt (per-socket); if none, leave "" (server will error as it should)
          outStmt = sess.unnamedStmt ?? "";
        } else {
          outStmt = ns(sess, stmt.str);
        }

        const outBody = concat(
          te.encode(outPortal),
          zero(),
          te.encode(outStmt),
          zero(),
          wr16(nFmt),
          fmtBytes,
          wr16(nParams),
          paramVals,
          wr16(nResFmt),
          resFmtBytes
        );
        return withLength(header, outBody);
      }

      case FrontendMessageCode.Describe: {
        let off = 0;
        const kind = body[off];
        off += 1; // 'S' or 'P'
        const nm = readCString(body, off);
        let outName = nm.str;
        if (kind === 0x53 /*'S'*/) {
          outName =
            nm.str.length === 0 ? (sess.unnamedStmt ?? "") : ns(sess, nm.str);
        } else {
          outName =
            nm.str.length === 0 ? (sess.unnamedPortal ?? "") : ns(sess, nm.str);
        }
        const outBody = concat(
          new Uint8Array([kind]),
          te.encode(outName),
          zero()
        );
        return withLength(header, outBody);
      }

      case FrontendMessageCode.Close: {
        let off = 0;
        const kind = body[off];
        off += 1;
        const nm = readCString(body, off);
        let outName = nm.str;
        if (kind === 0x53 /*'S'*/) {
          outName =
            nm.str.length === 0 ? (sess.unnamedStmt ?? "") : ns(sess, nm.str);
          // closing unnamed => forget mapping
          if (nm.str.length === 0) sess.unnamedStmt = undefined;
        } else {
          outName =
            nm.str.length === 0 ? (sess.unnamedPortal ?? "") : ns(sess, nm.str);
          if (nm.str.length === 0) sess.unnamedPortal = undefined;
        }
        const outBody = concat(
          new Uint8Array([kind]),
          te.encode(outName),
          zero()
        );
        return withLength(header, outBody);
      }

      case FrontendMessageCode.Execute: {
        let off = 0;
        const portal = readCString(body, off);
        off = portal.next;
        const maxRows = dv32(body, off);
        const outPortal =
          portal.str.length === 0
            ? (sess.unnamedPortal ?? "")
            : ns(sess, portal.str);
        const outBody = concat(te.encode(outPortal), zero(), wr32(maxRows));
        return withLength(header, outBody);
      }

      case FrontendMessageCode.Sync: {
        // portals are dropped at Sync
        sess.unnamedPortal = undefined;
        return msg;
      }

      default:
        return msg;
    }
  };

  const rewriteFrontendForSocket = (
    sess: Session,
    buf: Uint8Array
  ): Uint8Array => {
    let off = 0;
    const parts: Uint8Array[] = [];
    while (off < buf.length) {
      const len = dv32(buf, off + 1);
      const end = off + 1 + len;
      parts.push(rewriteOneMessage(sess, buf.subarray(off, end)));
      off = end;
    }
    return concat(...parts);
  };

  // --- owner handling ---
  const startWatchdog = (s: net.Socket) => {
    const sess = sessions.get(s);
    if (!sess) return;
    if (sess.watchdog) clearTimeout(sess.watchdog);
    sess.watchdog = setTimeout(() => {
      try {
        s.destroy(new Error("owner stalled"));
      } catch {}
    }, OWNER_WATCHDOG_MS);
  };
  const clearWatchdog = (s: net.Socket) => {
    const sess = sessions.get(s);
    if (sess?.watchdog) {
      clearTimeout(sess.watchdog);
      sess.watchdog = null;
    }
  };
  const claimOwnerIfFree = (s: net.Socket) => {
    if (!owner) {
      owner = s;
      startWatchdog(s);
    }
  };
  const releaseOwnerIf = (s: net.Socket) => {
    if (owner === s) {
      clearWatchdog(s);
      owner = null;
    }
  };

  const getReadyStatus = async (raw: Uint8Array): Promise<number | null> => {
    let status: number | null = null;
    for await (const msg of getMessages(raw)) {
      if (msg[0] === BackendMessageCode.ReadyForQuery)
        status = msg[msg.length - 1];
    }
    return status;
  };

  const processOne = async (socket: net.Socket, buf: Uint8Array) => {
    const sess = sessions.get(socket)!;
    const patchedIn = rewriteFrontendForSocket(sess, buf);
    const raw = await db.execProtocolRawSync(patchedIn);

    if (owner === socket) startWatchdog(socket);

    const patch = patchBySocket.get(socket);
    const gen = patch ? patch.filterResponse(buf, raw) : getMessages(raw);
    const parts: Uint8Array[] = [];
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        if (value) parts.push(value);
        break;
      }
      if (value) parts.push(value);
    }
    if (parts.length === 1) return parts[0];
    if (parts.length === 0) return new Uint8Array(0);
    return concat(...parts);
  };

  const maybeClaimOnEnqueue = (socket: net.Socket, buf: Uint8Array) => {
    const tag = buf[0];
    if (tag === FrontendMessageCode.Parse || tag === FrontendMessageCode.Bind) {
      claimOwnerIfFree(socket);
      return;
    }
    if (tag === FrontendMessageCode.Query) {
      const len = dv32(buf, 1);
      const body = buf.subarray(5, 1 + len);
      const { str: sql } = readCString(body, 0);
      if (isBeginLike(sql)) {
        const sess = sessions.get(socket);
        if (sess) sess.inTxn = true;
        claimOwnerIfFree(socket);
      }
    }
  };

  const maybeReleaseAfterProcess = async (
    socket: net.Socket,
    inBuf: Uint8Array,
    outBuf: Uint8Array
  ) => {
    const sess = sessions.get(socket);

    const r4q = await getReadyStatus(outBuf); // 'I' | 'T' | 'E'
    if (r4q !== null) {
      const inTxnNow = r4q === 0x54 /*T*/ || r4q === 0x45; /*E*/
      if (sess) sess.inTxn = inTxnNow;
      if (!inTxnNow && inBuf[0] !== FrontendMessageCode.Sync)
        releaseOwnerIf(socket);
    }

    if (inBuf[0] === FrontendMessageCode.Sync) {
      if (!sess?.inTxn) releaseOwnerIf(socket);
      return;
    }

    if (inBuf[0] === FrontendMessageCode.Query) {
      const len = dv32(inBuf, 1);
      const body = inBuf.subarray(5, 1 + len);
      const { str: sql } = readCString(body, 0);
      if (isCommitOrRollback(sql)) {
        if (sess) sess.inTxn = false;
        releaseOwnerIf(socket);
        return;
      }
    }
  };

  const processQueue = async (): Promise<void> => {
    if (processing) return;
    processing = true;
    try {
      while (true) {
        if (owner) {
          const idx = taskQueue.findIndex((t) => t.socket === owner);
          if (idx === -1) break;
          const task = taskQueue.splice(idx, 1)[0]!;
          try {
            const resp = await processOne(task.socket, task.data);
            task.resolve(resp);
            await maybeReleaseAfterProcess(task.socket, task.data, resp);
          } catch (err) {
            task.reject(err);
            releaseOwnerIf(task.socket);
          }
          continue;
        }

        if (taskQueue.length === 0) break;

        const task = taskQueue.shift()!;
        try {
          const resp = await processOne(task.socket, task.data);
          task.resolve(resp);
          await maybeReleaseAfterProcess(task.socket, task.data, resp);
        } catch (err) {
          task.reject(err);
        }

        if (
          task.data[0] === FrontendMessageCode.Parse ||
          task.data[0] === FrontendMessageCode.Bind
        ) {
          claimOwnerIfFree(task.socket);
        }
      }
    } finally {
      processing = false;
    }
  };

  // --- server ---
  const server = net.createServer(async (socket) => {
    const sid = "s" + Math.random().toString(36).slice(2);
    sessions.set(socket, {
      id: sid,
      inTxn: false,
      watchdog: null,
      cS: 0,
      cP: 0,
    });

    const conn = await fromNodeSocket(socket, {
      serverVersion: "16.3",
      auth: {
        method: "password",
        getClearTextPassword: () => password,
        validateCredentials: async (_, state) => {
          if (
            state.clientParams?.database &&
            state.clientParams.database !== "postgres"
          ) {
            await db.exec(`SET search_path TO ${state.clientParams.database}`);
          }
          return true;
        },
      },
      async onStartup() {
        await db.waitReady;
      },
      async onMessage(data, { isAuthenticated }) {
        if (!isAuthenticated) return;
        maybeClaimOnEnqueue(socket, data);
        return new Promise<Uint8Array>((resolve, reject) => {
          taskQueue.push({ socket, data, resolve, reject });
          void processQueue();
        });
      },
    });

    patchBySocket.set(socket, new PGliteExtendedQueryPatch(conn));

    const cleanupSocket = () => {
      releaseOwnerIf(socket);
      for (let i = taskQueue.length - 1; i >= 0; i--) {
        if (taskQueue[i]!.socket === socket) {
          try {
            taskQueue[i]!.reject(new Error("Socket closed"));
          } catch {}
          taskQueue.splice(i, 1);
        }
      }
      const sess = sessions.get(socket);
      if (sess) {
        sess.unnamedPortal = undefined;
        sess.unnamedStmt = undefined;
      }
      clearWatchdog(socket);
      sessions.delete(socket);
      patchBySocket.delete(socket);
      void processQueue();
    };

    socket.on("close", cleanupSocket);
    socket.on("end", cleanupSocket);
    socket.on("error", cleanupSocket);
  });

  await new Promise<void>((resolve) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr) throw new Error("no address");
  // @ts-ignore
  const port = addr.port;
  if (!port) throw new Error("no port");

  const url = `postgres://postgres:${password}@127.0.0.1:${port}`;
  self.postMessage({ url });
};

// https://github.com/electric-sql/pglite/issues/223#issuecomment-2332810579
class PGliteExtendedQueryPatch {
  isExtendedQuery = false;
  lastReadyForQuery: Uint8Array | null = null;

  constructor(public connection: PostgresConnection) {}

  async *filterResponse(message: Uint8Array, response: Uint8Array) {
    if (
      message[0] === FrontendMessageCode.Parse ||
      message[0] === FrontendMessageCode.Bind
    ) {
      this.isExtendedQuery = true;
      this.lastReadyForQuery = null;
    }

    if (message[0] === FrontendMessageCode.Sync) {
      this.isExtendedQuery = false;
      let readyFromSync: Uint8Array | null = null;
      for await (const resp of getMessages(response)) {
        if (resp[0] === BackendMessageCode.ReadyForQuery) {
          readyFromSync = resp;
          continue;
        }
        yield resp;
      }
      const ready =
        readyFromSync ??
        this.lastReadyForQuery ??
        this.connection.createReadyForQuery();
      this.lastReadyForQuery = null;
      return ready;
    }

    for await (const m of getMessages(response)) {
      if (this.isExtendedQuery && m[0] === BackendMessageCode.ReadyForQuery) {
        this.lastReadyForQuery = m;
        continue;
      }
      yield m;
    }
    return null;
  }
}
