import "dotenv/config";
import { defaultNodePorts } from "@topo-editor/topology-shared";
import { toPrismaJson } from "../common/json";
import { prisma } from "../prisma/client";

async function main() {
  const rows = await prisma.topologyNodeType.findMany();

  for (const row of rows) {
    const config = row.configJson as Record<string, unknown>;
    await prisma.topologyNodeType.update({
      where: { id: row.id },
      data: {
        configJson: toPrismaJson({
          ...config,
          ports: defaultNodePorts
        })
      }
    });
  }

  console.log(`Updated ${rows.length} node type port configs`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
