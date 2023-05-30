import { Application, Router } from "https://deno.land/x/oak@v12.5.0/mod.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { connect } from "https://deno.land/x/redis@v0.29.4/mod.ts";

// DB
const config = "postgres://tod:test@localhost:5430/sample";
const client = new Client(config);

// redis
const redis = await connect({
  hostname: "127.0.0.1",
  port: 6379,
});

// APP
const app = new Application();
const router = new Router();

// Router
router
  .get("/", async (ctx) => {
    const text = await Deno.readTextFile("./index.html");
    ctx.response.headers.set("Content-Type", "text/html");
    ctx.response.body = text;
  })
  .get("/todos", async (ctx) => {
    const todos = await redis.get("todos");
    if (todos) {
      console.log(todos);
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
