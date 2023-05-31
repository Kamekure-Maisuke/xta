import { Application, Router } from "https://deno.land/x/oak@v12.5.0/mod.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { connect } from "https://deno.land/x/redis@v0.29.4/mod.ts";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import { createPasswordHash, isPassword } from "./util.ts";

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
    const hashPassword = await createPasswordHash(`${username}-${password}`);
    console.log(hashPassword);

    // DB確認
    await client.connect();
    const result = await client
      .queryObject`SELECT id FROM users WHERE username = ${username} AND password = ${hashPassword}`;
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
  .get("/register", async (ctx) => {
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

    // 新規ユーザー登録画面
    const text = await Deno.readTextFile("./register.html");
    ctx.response.headers.set("Content-Type", "text/html");
    ctx.response.body = text;
  })
  .post("/register", async (ctx) => {
    // ユーザー登録処理
    const body = ctx.request.body({ type: "form" });
    const value = await body.value;
    const username = value.get("username")?.trim();
    const password = value.get("password")?.trim();
    if (!username || !password) { // 入力がなければ終了。
      return;
    }

    // DB接続
    await client.connect();

    // 存在チェック
    const result = await client
      .queryObject`SELECT id FROM users WHERE username = ${username}`;
    if (result.rowCount) {
      console.log("入力されたユーザー名はすでに存在しています。");
      ctx.response.redirect("/register");
      return;
    }

    // 形式チェック
    if (!isPassword(password)) {
      console.log(
        "パスワードは「10文字以上64文字以下」で使用できる文字は「アルファベット大文字小文字・数字・ピリオド・スラッシュ・クエスチョン」です。",
      );
      ctx.response.redirect("/register");
      return;
    }

    // 登録処理
    const hashPassword = await createPasswordHash(`${username}-${password}`);
    await client
      .queryArray`INSERT INTO users (username, password) VALUES (${username}, ${hashPassword})`;
    await client.end();
    console.log("正常にユーザーが登録されました。");
    ctx.response.redirect("/login");
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
  })
  .post("/logout", async (ctx) => {
    const sessionId = await ctx.cookies.get("session");
    if (!sessionId) {
      ctx.response.redirect("/login");
      return;
    }
    await redis.del(`${sessionPrefix}${sessionId}`);
    await ctx.cookies.delete("session");
    ctx.response.redirect("/login");
  });

// Middle
app.use(router.routes());
app.use(router.allowedMethods());

// Start
await app.listen({ port: 8000 });
