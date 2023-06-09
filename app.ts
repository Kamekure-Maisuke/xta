import {
  Application,
  isHttpError,
  Router,
} from "https://deno.land/x/oak@v12.5.0/mod.ts";
import { getQuery } from "https://deno.land/x/oak@v12.5.0/helpers.ts";
import "https://deno.land/std@0.190.0/dotenv/load.ts";
import { renderFileToString } from "https://deno.land/x/dejs@0.10.3/mod.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { connect } from "https://deno.land/x/redis@v0.29.4/mod.ts";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import { createPasswordHash, isPassword } from "./util.ts";
import { USER_LEVEL } from "./config.ts";
import { ListObjectsV2Command, S3Client } from "npm:@aws-sdk/client-s3";

// DB
const postgresUser = Deno.env.get("POSTGRES_USER");
const postgresPassword = Deno.env.get("POSTGRES_PASSWORD");
const config =
  `postgres://${postgresUser}:${postgresPassword}@localhost:5430/sample`;
const client = new Client(config);

// redis + session
const redis = await connect({
  hostname: "127.0.0.1",
  port: 6379,
});
const sessionPrefix = "session:";
type UserSession = {
  id: number;
  name: string;
  level: number;
};

// MinIO
const s3 = new S3Client({
  region: "ap-northeast-1",
  endpoint: "http://localhost:9000",
  forcePathStyle: true,
  credentials: {
    accessKeyId: Deno.env.get("MINIO_ROOT_USER") || "",
    secretAccessKey: Deno.env.get("MINIO_ROOT_PASSWORD") || "",
  },
});

// APP
const app = new Application();
const router = new Router();

// Middle
app.use(async (context, next) => {
  try {
    await next();
  } catch (err) {
    if (isHttpError(err)) {
      context.response.status = err.status;
    } else {
      context.response.status = 500;
    }
    context.response.body = { error: err.message };
    context.response.type = "json";
  }
});
app.use(router.routes());
app.use(router.allowedMethods());

// ルーター : 一般系
router
  .get("/", async (ctx) => {
    // 未ログインならlogin画面へredirect
    const sessionId = await ctx.cookies.get("session");
    if (!sessionId) {
      ctx.response.redirect("/login");
      return;
    }
    const sessionData = await redis.get(
      `${sessionPrefix}${sessionId}`,
    );
    if (!sessionData) {
      ctx.response.redirect("/login");
      return;
    }

    // ログイン済みならindexページ表示
    // 未ログインならloginページ表示
    const userSession: UserSession = JSON.parse(sessionData);
    ctx.response.headers.set("Content-Type", "text/html");
    ctx.response.body = await renderFileToString(`${Deno.cwd()}/index.html`, {
      login_name: userSession.name,
    });
  })
  .get("/login", async (ctx) => {
    // ログイン済みならindexページへredirect
    const sessionId = await ctx.cookies.get("session");
    if (sessionId) {
      const sessionData = await redis.get(
        `${sessionPrefix}${sessionId}`,
      );
      if (sessionData) {
        ctx.response.redirect("/");
        return;
      }
    }

    // 未ログインならloginページ表示
    ctx.request.url.pathname = "login.html";
    await ctx.send({
      root: Deno.cwd(),
    });
  })
  .post("/login", async (ctx) => {
    // フォーム中身取得
    const body = ctx.request.body({ type: "form" });
    const value = await body.value;
    const username = value.get("username")?.trim();
    const password = value.get("password")?.trim();

    // 入力がないか全て空白であればNG
    if (!username || !password) {
      return;
    }

    // 入力パスワードをハッシュ化
    const hashPassword = await createPasswordHash(`${username}-${password}`);

    // 既存ユーザー確認
    await client.connect();
    const result = await client
      .queryObject`SELECT id, name, level FROM users WHERE name = ${username} AND password = ${hashPassword}`;
    await client.end();

    // なければlogin画面にリダイレクト
    if (!result.rowCount) {
      ctx.response.redirect("/login");
      return;
    }

    // セッション保存(redis, cookie)
    const sessionId = crypto.randomUUID();
    await redis.set(
      `${sessionPrefix}${sessionId}`,
      JSON.stringify(result.rows[0]),
    );
    ctx.cookies.set("session", sessionId);

    // 全て正常ならindexへredirect
    ctx.response.redirect("/");
  })
  .get("/register", async (ctx) => {
    // ログイン済みならindexページへredirect
    const sessionId = await ctx.cookies.get("session");
    if (sessionId) {
      const sessionData = await redis.get(
        `${sessionPrefix}${sessionId}`,
      );
      if (sessionData) {
        ctx.response.redirect("/");
        return;
      }
    }

    // 未ログインならregisterページ表示
    ctx.request.url.pathname = "register.html";
    await ctx.send({
      root: Deno.cwd(),
    });
  })
  .post("/register", async (ctx) => {
    // フォーム中身
    const body = ctx.request.body({ type: "form" });
    const value = await body.value;
    const username = value.get("username")?.trim();
    const password = value.get("password")?.trim();
    const level = USER_LEVEL.GENELAL;

    // 入力がなければ終了
    if (!username || !password) {
      return;
    }

    await client.connect();

    // 既存ユーザーチェック
    const result = await client
      .queryObject`SELECT id FROM users WHERE name = ${username}`;
    if (result.rowCount) {
      console.log("入力されたユーザー名はすでに存在しています。");
      ctx.response.redirect("/register");
      return;
    }

    // パスワード形式チェック。あっていなければregister画面へredirect
    if (!isPassword(password)) {
      console.log(
        "パスワードは「10文字以上64文字以下」で使用できる文字は「アルファベット大文字小文字・数字・ピリオド・スラッシュ・クエスチョン」です。",
      );
      ctx.response.redirect("/register");
      return;
    }

    // ユーザー登録処理。
    const hashPassword = await createPasswordHash(`${username}-${password}`);
    await client
      .queryArray`INSERT INTO users (name, password, level) VALUES (${username}, ${hashPassword}, ${level})`;
    await client.end();

    // 正常登録後はloginへredirect
    console.log("正常にユーザーが登録されました。");
    ctx.response.redirect("/login");
  })
  .get("/api/todos", async (ctx) => {
    // todo: 認証チェック
    const params = getQuery(ctx);
    const search = params.search;
    const todos = await redis.get("todos");
    if (todos) {
      const todoJson = JSON.parse(todos);
      if (!search) {
        ctx.response.body = todoJson;
        return;
      }
      const filterTodos = {
        limit: todoJson.limit,
        data: todoJson.data.filter((d) => d.title.includes(search)),
      };
      ctx.response.body = filterTodos;
    } else {
      await client.connect();
      const array_result = await client.queryObject(
        "SELECT * FROM todos",
      );
      await client.end();
      const todos = JSON.stringify(array_result.rows);
      const body = {
        size: array_result.rowCount,
        data: JSON.parse(todos),
      };
      ctx.response.body = body;
      await redis.set("todos", JSON.stringify(body));
    }
  })
  .post("/api/todos", async (ctx) => {
    const form = ctx.request.body({ type: "form" });
    const value = await form.value;
    const title = value.get("title")?.trim();
    if (!title) {
      return;
    }
    await client.connect();
    await client
      .queryArray`INSERT INTO todos (title) VALUES (${title})`;
    const array_result = await client.queryObject("SELECT * FROM todos");
    await client.end();
    const todos = JSON.stringify(array_result.rows);
    const body = {
      size: array_result.rowCount,
      data: JSON.parse(todos),
    };
    await redis.set("todos", JSON.stringify(body));
    ctx.response.redirect("/");
  })
  .delete("/api/todos/:id", async (ctx) => {
    const id = ctx.params.id;

    // idで削除
    await client.connect();
    await client.queryArray`DELETE FROM todos WHERE id = ${id}`;

    // redisにセット
    const array_result = await client.queryObject("SELECT * FROM todos");
    await client.end();
    const todos = JSON.stringify(array_result.rows);
    const body = {
      size: array_result.rowCount,
      data: JSON.parse(todos),
    };
    await redis.set("todos", JSON.stringify(body));
    ctx.response.status = 200;
  })
  .get("/api/images", async (ctx) => {
    // PNG画像一覧取得
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: "sample",
      }),
    );
    const contents = result.Contents;
    if (!contents) {
      ctx.response.body = {
        error: "not objects",
      };
      return;
    }
    const images = contents.filter((content) => {
      if (!content.Key) return false;
      return /png$/.test(content.Key);
    });
    if (!images.length) {
      ctx.response.body = {
        error: "not png objects",
      };
      return;
    }

    ctx.response.body = images.map((image) => {
      return {
        name: image.Key,
        size: image.Size,
        lastModified: image.LastModified,
      };
    });
  })
  .post("/logout", async (ctx) => {
    // 未ログインならlogin画面へredirect
    const sessionId = await ctx.cookies.get("session");
    if (!sessionId) {
      ctx.response.redirect("/login");
      return;
    }

    // cookie及びredisのセッション情報削除
    await redis.del(`${sessionPrefix}${sessionId}`);
    await ctx.cookies.delete("session");

    ctx.response.redirect("/login");
  });

/**
 * ルーター : 管理系
 */
router
  .get("/admin", async (ctx) => {
    // 未ログインならadminのlogin画面へredirect
    const sessionId = await ctx.cookies.get("session");
    if (!sessionId) {
      ctx.response.redirect("/admin/login");
      return;
    }

    // ログインユーザー情報取得
    const sessionData = await redis.get(
      `${sessionPrefix}${sessionId}`,
    ) as string;
    const userSession: UserSession = JSON.parse(sessionData);

    // ログインユーザーがマネージャー未満の人はNG
    if (!sessionData || userSession.level < USER_LEVEL.MANAGE) {
      ctx.response.redirect("/admin/login");
      return;
    }

    // マネージャー以上ならadminページ表示
    ctx.request.url.pathname = "admin.html";
    await ctx.send({
      root: Deno.cwd(),
    });
  })
  .get("/admin/login", async (ctx) => {
    // ログイン済みならindexページへredirect
    const sessionId = await ctx.cookies.get("session");
    if (sessionId) {
      // ログインユーザー情報取得
      const sessionData = await redis.get(
        `${sessionPrefix}${sessionId}`,
      ) as string;
      const userSession: UserSession = JSON.parse(sessionData);
      // ログインユーザーがマネージャー以上の人はadminへredirect
      if (sessionData && userSession.level >= USER_LEVEL.MANAGE) {
        ctx.response.redirect("/admin");
        return;
      }
    }

    // 未ログインならadmin loginページ表示
    const text = await Deno.readTextFile("./admin_login.html");
    ctx.response.headers.set("Content-Type", "text/html");
    ctx.response.body = text;
  })
  .post("/admin/login", async (ctx) => {
    // フォーム中身取得
    const body = ctx.request.body({ type: "form" });
    const value = await body.value;
    const username = value.get("username")?.trim();
    const password = value.get("password")?.trim();

    // 入力がなければ終了。
    if (!username || !password) {
      return;
    }

    // 入力パスワードのハッシュ化
    const hashPassword = await createPasswordHash(`${username}-${password}`);

    // 既存ユーザー確認
    await client.connect();
    const result = await client
      .queryObject`SELECT id, name, level FROM users WHERE name = ${username} AND password = ${hashPassword} AND level >= ${USER_LEVEL.MANAGE}`;
    await client.end();

    // なければadmin login画面にリダイレクト
    if (!result.rowCount) {
      ctx.response.redirect("/admin/login");
      return;
    }

    // セッション保存(redis, cookie)
    const sessionId = crypto.randomUUID();
    await redis.set(
      `${sessionPrefix}${sessionId}`,
      JSON.stringify(result.rows[0]),
    );
    ctx.cookies.set("session", sessionId);

    // 正常ならadmin表示
    ctx.response.redirect("/admin");
  })
  .post("/admin/logout", async (ctx) => {
    // 未ログインならadmin login画面へredirect
    const sessionId = await ctx.cookies.get("session");
    if (!sessionId) {
      ctx.response.redirect("/admin/login");
      return;
    }

    // cookie及びredisのセッション情報削除
    await redis.del(`${sessionPrefix}${sessionId}`);
    await ctx.cookies.delete("session");

    ctx.response.redirect("/admin/login");
  });

// 404
app.use((context) => {
  context.response.status = 404;
  context.response.body = {
    error: "お探しのページがみつかりません。",
  };
});

// Start
await app.listen({ port: 8000 });
