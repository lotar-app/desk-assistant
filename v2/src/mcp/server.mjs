import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CapabilityRepository } from "./capability-repository.mjs";
import { ContainerRepository } from "./container-repository.mjs";

const markerSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    "Use only letters, numbers, dot, underscore, colon, or hyphen");

const containerIdSchema = z.string().refine(value => value.trim().length > 0, {
  message: "Container ID must not be empty or whitespace"
});
const lifecycleSchema = z.enum(["ACTIVE", "ARCHIVED", "ALL"]);
const getContainersInputSchema = z.union([
  z.object({ containerId: containerIdSchema }).strict(),
  z.object({
    parentId: containerIdSchema.optional(),
    lifecycle: lifecycleSchema.default("ACTIVE")
  }).strict()
]);

const containerSchema = z.object({
  containerId: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  status: z.string(),
  focus: z.string().nullable(),
  owner: z.string().nullable(),
  nextAction: z.string().nullable(),
  lifecycleState: z.enum(["ACTIVE", "ARCHIVED"]),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable()
}).strict();

export function createDeskMcpServer(env) {
  const server = new McpServer({ name: "desk-v2-capability-test", version: "0.1.0" });
  const repository = new CapabilityRepository(env.DESK_V2_DB);
  const containerRepository = new ContainerRepository(env.DESK_V2_DB);

  server.registerTool(
    "desk_v2_get_containers",
    {
      title: "Get Desk V2 Containers",
      description: "Reads Desk V2 root Containers, direct children of one Container, or one Container by stable ID. Supports ACTIVE and ARCHIVED lifecycle filtering for list operations. Does not read Tasks or Desk V1 and never writes data.",
      inputSchema: getContainersInputSchema,
      outputSchema: z.object({
        scope: z.enum(["ROOTS", "CHILDREN", "BY_ID"]),
        parentId: z.string().nullable(),
        lifecycle: lifecycleSchema.nullable(),
        count: z.number().int().nonnegative(),
        containers: z.array(containerSchema)
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => result(await containerRepository.getContainers(input))
  );

  server.registerTool(
    "desk_v2_capability_read",
    {
      title: "Read Desk V2 capability state",
      description: "Reads harmless Desk V2 identity and empty-domain counters without writing data.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        service: z.literal("desk-v2"),
        environment: z.literal("v2-development"),
        schemaVersion: z.literal("0001_foundation"),
        containerCount: z.number().int().nonnegative(),
        taskCount: z.number().int().nonnegative()
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => result(await repository.readSnapshot())
  );

  server.registerTool(
    "desk_v2_capability_write",
    {
      title: "Write a Desk V2 capability marker",
      description: "Writes one validated marker only to the isolated MCP capability-test table.",
      inputSchema: z.object({
        marker: markerSchema.describe("A 1-64 character capability-test marker")
      }),
      outputSchema: z.object({
        id: z.number().int().positive(),
        marker: z.string(),
        createdAt: z.string()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ marker }) => result(await repository.createMarker(marker))
  );

  return server;
}

function result(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value
  };
}
