import { Application, Router } from "https://deno.land/x/oak@v12.5.0/mod.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { connect } from "https://deno.land/x/redis@v0.29.4/mod.ts";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

// DB
const config = "postgres://tod:test@localhost:5430/sample";
const client = new Client(config);

// redis + session
const redis = await connect({
  hostname: "127.0.0.1",
  port: 6379,
});
const sessionPrefix = "session:";

// APP
const app = new Application();
const router = new Router();

// Router
router
  .get("/", async (ctx) => {
    // ログイン処理
    const sessionId = await ctx.cookies.get("session");

    // ログイン済みチェック
    if (!sessionId) {
      ctx.response.redirect("/login");
      return;
    }
    const userId = await redis.get(`${sessionPrefix}${sessionId}`);
    if (!userId) {
      ctx.response.redirect("/login");
      return;
    }

    // ログイン済みなら初期ページ表示
    const text = await Deno.readTextFile("./index.html");
    ctx.response.headers.set("Content-Type", "text/html");
    ctx.response.body = text;
  })
  .get("/login", async (ctx) => {
    // ログイン処理
    const sessionId = await ctx.cookies.get("session");

    // ログイン済みチェック
    if (sessionId) {
      const userId = await redis.get(`${sessionPrefix}${sessionId}`);
      if (userId) {
        ctx.response.redirect("/");
        return;
      }
    }
    const text = await Deno.readTextFile("./login.html");
    ctx.response.headers.set("Content-Type", "text/html");
    ctx.response.body = text;
  })
  .post("/login", async (ctx) => {
    const body = ctx.request.body({ type: "form" });
    const value = await body.value;
    const username = value.get("username")?.trim();
    const password = value.get("password")?.trim();
    if (!username || !password) { // 入力がなければ終了。
      return;
    }

    // DB確認
    await client.connect();
    const result = await client
      .queryObject`SELECT id FROM users WHERE username = ${username} AND password = ${password}`;
    await client.end();
    if (!result.rowCount) { // なければ同一画面にリダイレクト
      ctx.response.redirect("/login");
      return;
    }

    // セッション保存(redis, cookie)
    const sessionId = crypto.randomUUID();
    await redis.set(
      `${sessionPrefix}${sessionId}`,
      String(result.rows[0]?.id),
    );
    ctx.cookies.set("session", sessionId);
    ctx.response.redirect("/");
  })
  .get("/todos", async (ctx) => {
    // todo: 認証チェック

    const todos = await redis.get("todos");
    if (todos) {
      ctx.response.body = todos;
    } else {
      await client.connect();
      const array_result = await client.queryObject("SELECT * FROM todos");
      await client.end();
      ctx.response.body = array_result.rows;
      await redis.set("todos", JSON.stringify(array_result.rows));
    }
  })
  .post("/todos", async (ctx) => {
    const body = ctx.request.body({ type: "form" });
    const value = await body.value;
    const title = value.get("title")?.trim();
    if (!title) {
      return;
    }
    await client.connect();
    await client
      .queryArray`INSERT INTO todos (title) VALUES (${title})`;
    const array_result = await client.queryObject("SELECT * FROM todos");
    await client.end();
    await redis.set("todos", JSON.stringify(array_result.rows));
    ctx.response.redirect("/");
  });

// Middle
app.use(router.routes());
app.use(router.allowedMethods());

// Start
await app.listen({ port: 8000 });
