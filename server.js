// 梁州商务工作台 - 实时共享后端 (零依赖 Node.js)
// 功能: 静态页面服务 + 登录鉴权(session) + 数据CRUD + SSE实时推送
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const SEED_PATH = path.join(DATA_DIR, "seed.json");
const USERS_PATH = path.join(DATA_DIR, "users.json");

const SESSION_MAX_AGE = 12 * 60 * 60 * 1000; // 12小时
const ALLOWED_SHEETS = ["合作表", "建联表", "合作协议进度", "档期表", "月度刊例价"];

// ---------- 数据初始化 ----------
function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    // 若seed存在则复制，否则创建空结构
    const base = fs.existsSync(SEED_PATH)
      ? JSON.parse(fs.readFileSync(SEED_PATH, "utf-8"))
      : { "合作表": { data: [] }, "建联表": { data: [] }, "合作协议进度": { data: [] }, "档期表": { data: [] }, "月度刊例价": { data: [] } };
    fs.writeFileSync(STORE_PATH, JSON.stringify(base, null, 2), "utf-8");
  }
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
}

let STORE = ensureStore();

function persistStore() {
  fs.writeFileSync(STORE_PATH, JSON.stringify(STORE, null, 2), "utf-8");
}

// ---------- 用户初始化 ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, rec) {
  const hash = crypto.scryptSync(password, rec.salt, 64).toString("hex");
  return hash === rec.hash;
}

function ensureUsers() {
  if (!fs.existsSync(USERS_PATH)) {
    const admin = hashPassword("liangzhou2026");
    const users = {
      admin: { name: "管理员", role: "admin", salt: admin.salt, hash: admin.hash }
    };
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), "utf-8");
    console.log("[init] 已创建默认管理员 admin / liangzhou2026");
  }
  return JSON.parse(fs.readFileSync(USERS_PATH, "utf-8"));
}

let USERS = ensureUsers();

function persistUsers() {
  fs.writeFileSync(USERS_PATH, JSON.stringify(USERS, null, 2), "utf-8");
}

// ---------- 会话管理 (内存) ----------
const sessions = new Map(); // token -> {username, role, expires}

function createSession(username, role) {
  const token = crypto.randomBytes(24).toString("hex");
  const expires = Date.now() + SESSION_MAX_AGE;
  sessions.set(token, { username, role, expires });
  return token;
}
function getSessionFromReq(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.sid;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) { sessions.delete(token); return null; }
  return s;
}
function parseCookies(str) {
  const out = {};
  str.split(";").forEach(p => {
    const idx = p.indexOf("=");
    if (idx > -1) out[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
  });
  return out;
}
function setCookie(res, name, value, maxAge) {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ---------- SSE 客户端 ----------
const sseClients = new Set();

function broadcast() {
  const payload = `data: ${JSON.stringify({ type: "data", data: STORE })}\n\n`;
  sseClients.forEach(res => {
    try { res.write(payload); } catch (e) { sseClients.delete(res); }
  });
}

// ---------- 工具 ----------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("JSON解析失败")); }
    });
    req.on("error", reject);
  });
}
function publicUser(u, username) {
  return { username, name: u.name || username, role: u.role };
}

// ---------- 静态文件 ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end("Not Found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

// ---------- 主路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    // --- API ---
    if (p.startsWith("/api/")) {
      // 登录
      if (p === "/api/login" && req.method === "POST") {
        const body = await readBody(req);
        const u = USERS[body.username];
        if (u && verifyPassword(body.password, u)) {
          const token = createSession(body.username, u.role);
          setCookie(res, "sid", token, SESSION_MAX_AGE);
          return sendJSON(res, 200, publicUser(u, body.username));
        }
        return sendJSON(res, 401, { error: "用户名或密码错误" });
      }
      // 登出
      if (p === "/api/logout" && req.method === "POST") {
        const s = getSessionFromReq(req);
        if (s) sessions.delete(getToken(req));
        clearCookie(res, "sid");
        return sendJSON(res, 200, { ok: true });
      }
      // 当前用户
      if (p === "/api/me" && req.method === "GET") {
        const s = getSessionFromReq(req);
        if (!s) return sendJSON(res, 401, { error: "未登录" });
        const u = USERS[s.username];
        return sendJSON(res, 200, publicUser(u, s.username));
      }
      // 实时流
      if (p === "/api/stream" && req.method === "GET") {
        const s = getSessionFromReq(req);
        if (!s) { res.writeHead(401); res.end(); return; }
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });
        res.write("retry: 3000\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: "未登录" });

      // 拉取全部数据
      if (p === "/api/data" && req.method === "GET") {
        return sendJSON(res, 200, STORE);
      }
      // 单条/批量更新
      if (p === "/api/update" && req.method === "POST") {
        const body = await readBody(req);
        const sheet = body.sheet;
        const index = body.index;
        if (!ALLOWED_SHEETS.includes(sheet)) return sendJSON(res, 400, { error: "非法数据表" });
        const rows = STORE[sheet] && STORE[sheet].data;
        if (!rows || !Number.isInteger(index) || index < 0 || index >= rows.length) {
          return sendJSON(res, 400, { error: "索引越界" });
        }
        const apply = (field, value) => { rows[index][field] = value; };
        if (Array.isArray(body.changes)) {
          body.changes.forEach(c => { if (c && typeof c.field === "string") apply(c.field, c.value); });
        } else if (typeof body.field === "string") {
          apply(body.field, body.value);
        } else {
          return sendJSON(res, 400, { error: "缺少字段" });
        }
        persistStore();
        broadcast();
        return sendJSON(res, 200, { ok: true });
      }
      // 新增一行 (合作订单等)
      if (p === "/api/add" && req.method === "POST") {
        const body = await readBody(req);
        const sheet = body.sheet;
        if (!ALLOWED_SHEETS.includes(sheet)) return sendJSON(res, 400, { error: "非法数据表" });
        if (!body.row || typeof body.row !== "object") return sendJSON(res, 400, { error: "缺少行数据" });
        if (sheet === "合作表" && !body.row["制作进度"]) body.row["制作进度"] = "待开始";
        if (!STORE[sheet]) STORE[sheet] = { data: [] };
        STORE[sheet].data.push(body.row);
        persistStore();
        broadcast();
        return sendJSON(res, 200, { ok: true, index: STORE[sheet].data.length - 1 });
      }
      // 删除一行
      if (p === "/api/delete" && req.method === "POST") {
        const body = await readBody(req);
        const sheet = body.sheet;
        if (!ALLOWED_SHEETS.includes(sheet)) return sendJSON(res, 400, { error: "非法数据表" });
        const rows = STORE[sheet] && STORE[sheet].data;
        const index = body.index;
        if (!rows || !Number.isInteger(index) || index < 0 || index >= rows.length) {
          return sendJSON(res, 400, { error: "索引越界" });
        }
        rows.splice(index, 1);
        persistStore();
        broadcast();
        return sendJSON(res, 200, { ok: true });
      }
      // 重置数据 (管理员)
      if (p === "/api/reset" && req.method === "POST") {
        if (session.role !== "admin") return sendJSON(res, 403, { error: "仅管理员可重置" });
        if (fs.existsSync(SEED_PATH)) STORE = JSON.parse(fs.readFileSync(SEED_PATH, "utf-8"));
        else STORE = { "合作表": { data: [] }, "建联表": { data: [] }, "合作协议进度": { data: [] }, "档期表": { data: [] }, "月度刊例价": { data: [] } };
        persistStore();
        broadcast();
        return sendJSON(res, 200, { ok: true });
      }
      // 用户列表 (管理员)
      if (p === "/api/users" && req.method === "GET") {
        if (session.role !== "admin") return sendJSON(res, 403, { error: "仅管理员" });
        const list = Object.entries(USERS).map(([k, v]) => publicUser(v, k));
        return sendJSON(res, 200, list);
      }
      // 新增用户 (管理员)
      if (p === "/api/users" && req.method === "POST") {
        if (session.role !== "admin") return sendJSON(res, 403, { error: "仅管理员" });
        const body = await readBody(req);
        if (!body.username || !body.password) return sendJSON(res, 400, { error: "缺少用户名或密码" });
        if (USERS[body.username]) return sendJSON(res, 400, { error: "用户名已存在" });
        const h = hashPassword(body.password);
        USERS[body.username] = { name: body.name || body.username, role: body.role === "admin" ? "admin" : "member", salt: h.salt, hash: h.hash };
        persistUsers();
        return sendJSON(res, 200, { ok: true });
      }
      // 删除用户 (管理员, 不能删自己)
      if (p.startsWith("/api/users/") && req.method === "DELETE") {
        if (session.role !== "admin") return sendJSON(res, 403, { error: "仅管理员" });
        const username = decodeURIComponent(p.slice("/api/users/".length));
        if (username === session.username) return sendJSON(res, 400, { error: "不能删除自己" });
        if (!USERS[username]) return sendJSON(res, 404, { error: "用户不存在" });
        delete USERS[username];
        persistUsers();
        return sendJSON(res, 200, { ok: true });
      }
      // 修改密码 (管理员或本人)
      if (p === "/api/changepwd" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.username || !body.newPassword) return sendJSON(res, 400, { error: "缺少参数" });
        if (session.role !== "admin" && body.username !== session.username) {
          return sendJSON(res, 403, { error: "无权限" });
        }
        if (!USERS[body.username]) return sendJSON(res, 404, { error: "用户不存在" });
        const h = hashPassword(body.newPassword);
        USERS[body.username].salt = h.salt;
        USERS[body.username].hash = h.hash;
        persistUsers();
        return sendJSON(res, 200, { ok: true });
      }

      return sendJSON(res, 404, { error: "接口不存在" });
    }

    // --- 静态 ---
    return serveStatic(req, res, p);
  } catch (e) {
    console.error("[error]", e);
    if (!res.headersSent) sendJSON(res, 500, { error: e.message || "服务器错误" });
  }
});

function getToken(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies.sid;
}

server.listen(PORT, () => {
  console.log(`梁州商务工作台已启动: http://localhost:${PORT}`);
  console.log(`数据文件: ${STORE_PATH}`);
  console.log(`用户文件: ${USERS_PATH}`);
});
