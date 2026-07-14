import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerAssetRoutes } from "./modules/assets";
import { registerDataSourceRoutes } from "./modules/data-sources";
import { registerFileRoutes } from "./modules/files";
import { registerNodeTypeRoutes } from "./modules/node-types";
import { registerRuntimeRoutes } from "./modules/runtime";
import { registerTopologyRoutes } from "./modules/topologies";
import { prisma } from "./prisma/client";

const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });

await app.register(cors, {
  origin: true
});

app.get("/api/health", async () => ({
  code: 0,
  data: {
    service: "topo-editor-server",
    time: new Date().toISOString()
  }
}));

await registerNodeTypeRoutes(app);
await registerAssetRoutes(app);
await registerFileRoutes(app);
await registerDataSourceRoutes(app);
await registerTopologyRoutes(app);
await registerRuntimeRoutes(app);

const port = Number(process.env.SERVER_PORT ?? 3000);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
