-- Generated from apps/server/prisma/schema.prisma with:
-- pnpm --filter @topo-editor/server exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
--
-- Notes:
-- - Prisma generates cuid() values in Prisma Client, not as database defaults.
-- - Prisma maintains @updatedAt fields during Prisma writes, not via a database trigger.

-- CreateTable
CREATE TABLE "topology_node_type" (
    "id" TEXT NOT NULL,
    "type_code" VARCHAR(64) NOT NULL,
    "type_name" VARCHAR(128) NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "template_code" VARCHAR(64) NOT NULL,
    "icon" VARCHAR(512),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_no" INTEGER NOT NULL DEFAULT 0,
    "config_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_node_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_data_source" (
    "id" TEXT NOT NULL,
    "source_code" VARCHAR(64) NOT NULL,
    "source_name" VARCHAR(128) NOT NULL,
    "source_type" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_data_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology" (
    "id" TEXT NOT NULL,
    "topology_code" VARCHAR(64) NOT NULL,
    "topology_name" VARCHAR(128) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "current_version_id" TEXT,
    "remark" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_version" (
    "id" TEXT NOT NULL,
    "topology_id" TEXT NOT NULL,
    "version_no" VARCHAR(32) NOT NULL,
    "version_name" VARCHAR(128),
    "config_json" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_by" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topology_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_operation_log" (
    "id" TEXT NOT NULL,
    "topology_id" TEXT,
    "operation_type" VARCHAR(64) NOT NULL,
    "operation_desc" VARCHAR(512),
    "before_json" JSONB,
    "after_json" JSONB,
    "operator" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topology_operation_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "topology_node_type_type_code_key" ON "topology_node_type"("type_code");

-- CreateIndex
CREATE UNIQUE INDEX "topology_data_source_source_code_key" ON "topology_data_source"("source_code");

-- CreateIndex
CREATE UNIQUE INDEX "topology_topology_code_key" ON "topology"("topology_code");

-- CreateIndex
CREATE INDEX "topology_version_topology_id_idx" ON "topology_version"("topology_id");

-- CreateIndex
CREATE INDEX "topology_operation_log_topology_id_idx" ON "topology_operation_log"("topology_id");

-- AddForeignKey
ALTER TABLE "topology_version" ADD CONSTRAINT "topology_version_topology_id_fkey" FOREIGN KEY ("topology_id") REFERENCES "topology"("id") ON DELETE CASCADE ON UPDATE CASCADE;

