import { createServer } from "node:http";

const serviceName = process.env.HEALTH_STUB_NAME ?? "unspool-service";
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const startedAt = new Date().toISOString();

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        status: "ok",
        service: serviceName,
        startedAt,
        scaffold: true,
      }),
    );
    return;
  }

  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "not_found" }));
});

const stop = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

server.listen(port, "0.0.0.0", () => {
  console.log(`${serviceName} validation stub listening on port ${port}`);
});
