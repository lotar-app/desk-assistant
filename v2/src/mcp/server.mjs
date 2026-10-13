import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CapabilityRepository } from "./capability-repository.mjs";
import { ContainerDomainError, ContainerRepository } from "./container-repository.mjs";
import { TaskDomainError, TaskRepository } from "./task-repository.mjs";

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

const idempotencyKeySchema = z.string({ error: "INVALID_IDEMPOTENCY_KEY" })
  .transform(value => value.trim())
  .pipe(z.string().min(1, "INVALID_IDEMPOTENCY_KEY")
    .max(64, "INVALID_IDEMPOTENCY_KEY")
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "INVALID_IDEMPOTENCY_KEY"));
const requiredNameSchema = z.string({ error: "INVALID_NAME" })
  .transform(value => value.trim())
  .pipe(z.string().min(1, "INVALID_NAME"));
const createParentIdSchema = z.string({ error: "INVALID_PARENT_ID" })
  .transform(value => value.trim())
  .pipe(z.string().min(1, "INVALID_PARENT_ID"));
const optionalTextSchema = z.string().nullable().optional()
  .transform(value => {
    if (value === undefined || value === null) return null;
    const normalized = value.trim();
    return normalized || null;
  });
const createContainerInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  name: requiredNameSchema,
  parentId: createParentIdSchema.nullable().optional().transform(value => value ?? null),
  focus: optionalTextSchema,
  owner: optionalTextSchema,
  nextAction: optionalTextSchema
}).strict();
const createContainerOutputSchema = z.object({
  replayed: z.boolean(),
  container: containerSchema
}).strict();
const moveContainerIdSchema = z.string({ error: "INVALID_CONTAINER_ID" })
  .transform(value => value.trim())
  .pipe(z.string().min(1, "INVALID_CONTAINER_ID"));
const moveParentIdSchema = z.string({ error: "INVALID_NEW_PARENT_ID" })
  .transform(value => value.trim())
  .pipe(z.string().min(1, "INVALID_NEW_PARENT_ID"))
  .nullable();
const expectedVersionSchema = z.number({ error: "INVALID_EXPECTED_VERSION" })
  .int("INVALID_EXPECTED_VERSION")
  .positive("INVALID_EXPECTED_VERSION");
const moveContainerInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  containerId: moveContainerIdSchema,
  newParentId: moveParentIdSchema,
  expectedVersion: expectedVersionSchema
}).strict();
const moveContainerOutputSchema = z.object({
  replayed: z.boolean(),
  changed: z.boolean(),
  container: containerSchema
}).strict();
const updateRequiredTextSchema = code => z.string({ error: code })
  .transform(value => value.trim())
  .pipe(z.string().min(1, code));
const updateNullableTextSchema = code => z.string({ error: code }).nullable()
  .transform(value => {
    if (value === null) return null;
    const normalized = value.trim();
    return normalized || null;
  });
const updatePatchSchema = z.object({
  name: updateRequiredTextSchema("INVALID_CONTAINER_NAME").optional(),
  status: updateRequiredTextSchema("INVALID_CONTAINER_STATUS").optional(),
  focus: updateNullableTextSchema("INVALID_CONTAINER_FOCUS").optional(),
  owner: updateNullableTextSchema("INVALID_CONTAINER_OWNER").optional(),
  nextAction: updateNullableTextSchema("INVALID_CONTAINER_NEXT_ACTION").optional()
}, { error: "INVALID_PATCH" }).strict("INVALID_PATCH")
  .refine(patch => Object.keys(patch).length > 0, "INVALID_PATCH");
const updateContainerInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  containerId: moveContainerIdSchema,
  expectedVersion: expectedVersionSchema,
  patch: updatePatchSchema
}).strict();
const lifecycleContainerInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  containerId: moveContainerIdSchema,
  expectedVersion: expectedVersionSchema
}).strict();
const taskIdSchema = z.string({ error: "INVALID_TASK_ID" })
  .transform(value => value.trim())
  .pipe(z.string().min(1, "INVALID_TASK_ID"));
const taskLifecycleSchema = z.enum(["ACTIVE", "ARCHIVED", "ALL"], {
  error: "INVALID_LIFECYCLE"
});
const getTasksInputSchema = z.union([
  z.object({ taskId: taskIdSchema }).strict(),
  z.object({
    containerId: moveContainerIdSchema,
    lifecycle: taskLifecycleSchema.default("ACTIVE")
  }).strict()
]);
const taskSchema = z.object({
  taskId: z.string(),
  containerId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string().nullable(),
  assignee: z.string().nullable(),
  dueDate: z.string().nullable(),
  lifecycleState: z.enum(["ACTIVE", "ARCHIVED"]),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  archivedAt: z.string().nullable()
}).strict();
const requiredTaskTextSchema = code => z.string({ error: code })
  .transform(value => value.trim())
  .pipe(z.string().min(1, code));
const optionalTaskTextSchema = code => z.string({ error: code }).nullable().optional()
  .transform(value => {
    if (value === undefined || value === null) return null;
    const normalized = value.trim();
    return normalized || null;
  });
const createTaskInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  containerId: moveContainerIdSchema,
  title: requiredTaskTextSchema("INVALID_TASK_TITLE"),
  status: requiredTaskTextSchema("INVALID_TASK_STATUS"),
  description: optionalTaskTextSchema("INVALID_TASK_DESCRIPTION"),
  priority: optionalTaskTextSchema("INVALID_TASK_PRIORITY"),
  assignee: optionalTaskTextSchema("INVALID_TASK_ASSIGNEE"),
  dueDate: optionalTaskTextSchema("INVALID_TASK_DUE_DATE")
}).strict();
const createTaskOutputSchema = z.object({
  replayed: z.boolean(),
  task: taskSchema
}).strict();
const updateTaskPatchSchema = z.object({
  title: requiredTaskTextSchema("INVALID_TASK_TITLE").optional(),
  description: updateNullableTextSchema("INVALID_TASK_DESCRIPTION").optional(),
  status: requiredTaskTextSchema("INVALID_TASK_STATUS").optional(),
  priority: updateNullableTextSchema("INVALID_TASK_PRIORITY").optional(),
  assignee: updateNullableTextSchema("INVALID_TASK_ASSIGNEE").optional(),
  dueDate: updateNullableTextSchema("INVALID_TASK_DUE_DATE").optional()
}, { error: "INVALID_PATCH" }).strict("INVALID_PATCH")
  .refine(patch => Object.keys(patch).length > 0, "INVALID_PATCH")
  .meta({ minProperties: 1 });
const updateTaskInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  taskId: taskIdSchema,
  expectedVersion: expectedVersionSchema,
  patch: updateTaskPatchSchema
}).strict();
const updateTaskOutputSchema = z.object({
  replayed: z.boolean(),
  changed: z.boolean(),
  task: taskSchema
}).strict();
const toolErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean()
  }).strict()
}).strict();

export function createDeskMcpServer(env) {
  const server = new McpServer({ name: "desk-v2-capability-test", version: "0.1.0" });
  const repository = new CapabilityRepository(env.DESK_V2_DB);
  const containerRepository = new ContainerRepository(env.DESK_V2_DB);
  const taskRepository = new TaskRepository(env.DESK_V2_DB);

  server.registerTool(
    "desk_v2_create_container",
    {
      title: "Create Desk V2 Container",
      description: "Creates one active Desk V2 Container as a root or direct child. Requires an idempotency key and never creates Tasks or modifies Desk V1.",
      inputSchema: createContainerInputSchema,
      outputSchema: z.union([createContainerOutputSchema, toolErrorSchema]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await containerRepository.createContainer(input));
      } catch (error) {
        if (error instanceof ContainerDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The Container could not be created.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_move_container",
    {
      title: "Move Desk V2 Container",
      description: "Moves one active Desk V2 Container to root or under another active Container while preserving its identity, subtree, Tasks, and domain fields. Requires optimistic concurrency and an idempotency key.",
      inputSchema: moveContainerInputSchema,
      outputSchema: z.union([moveContainerOutputSchema, toolErrorSchema]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await containerRepository.moveContainer(input));
      } catch (error) {
        if (error instanceof ContainerDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The Container could not be moved.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_update_container",
    {
      title: "Update Desk V2 Container",
      description: "Updates only the descriptive fields of one active Desk V2 Container while preserving its identity, structure, lifecycle, subtree, and Tasks. Requires optimistic concurrency and an idempotency key.",
      inputSchema: updateContainerInputSchema,
      outputSchema: z.union([moveContainerOutputSchema, toolErrorSchema]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await containerRepository.updateContainer(input));
      } catch (error) {
        if (error instanceof ContainerDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The Container could not be updated.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_archive_container",
    {
      title: "Archive Desk V2 Container",
      description: "Archives one Desk V2 Container without changing its subtree or Tasks. Active descendants block a real transition. Requires optimistic concurrency and an idempotency key.",
      inputSchema: lifecycleContainerInputSchema,
      outputSchema: z.union([moveContainerOutputSchema, toolErrorSchema]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await containerRepository.archiveContainer(input));
      } catch (error) {
        if (error instanceof ContainerDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The Container could not be archived.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_restore_container",
    {
      title: "Restore Desk V2 Container",
      description: "Restores one Desk V2 Container when it is root or its parent is active, without changing its subtree or Tasks. Requires optimistic concurrency and an idempotency key.",
      inputSchema: lifecycleContainerInputSchema,
      outputSchema: z.union([moveContainerOutputSchema, toolErrorSchema]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await containerRepository.restoreContainer(input));
      } catch (error) {
        if (error instanceof ContainerDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The Container could not be restored.", true);
      }
    }
  );

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
    "desk_v2_create_task",
    {
      title: "Create Desk V2 Task",
      description: "Creates one active Task in an active Desk V2 Container with a server-generated stable ID and required idempotency key.",
      inputSchema: createTaskInputSchema,
      outputSchema: z.union([createTaskOutputSchema, toolErrorSchema]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await taskRepository.createTask(input));
      } catch (error) {
        if (error instanceof TaskDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The Task could not be created.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_get_tasks",
    {
      title: "Get Desk V2 Tasks",
      description: "Reads Tasks for one existing Container or one Task by stable ID. List lifecycle filters apply only to Tasks, including when the Container is archived. Never writes data.",
      inputSchema: getTasksInputSchema,
      outputSchema: z.union([z.object({
        scope: z.enum(["CONTAINER", "BY_ID"]),
        containerId: z.string().nullable(),
        lifecycle: taskLifecycleSchema.nullable(),
        count: z.number().int().nonnegative(),
        tasks: z.array(taskSchema)
      }).strict(), toolErrorSchema]),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await taskRepository.getTasks(input));
      } catch (error) {
        if (error instanceof TaskDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The Tasks could not be read.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_update_task",
    {
      title: "Update Desk V2 Task",
      description: "Updates only the editable fields of one active Task in an active Container while preserving identity, placement, lifecycle, completion, and archive state. Requires optimistic concurrency and an idempotency key.",
      inputSchema: updateTaskInputSchema,
      outputSchema: z.union([updateTaskOutputSchema, toolErrorSchema]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await taskRepository.updateTask(input));
      } catch (error) {
        if (error instanceof TaskDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The Task could not be updated.", true);
      }
    }
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

function errorResult(code, message, retryable) {
  const value = { error: { code, message, retryable } };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value
  };
}
