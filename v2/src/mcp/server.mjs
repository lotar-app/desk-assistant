import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CapabilityRepository } from "./capability-repository.mjs";
import { ContainerDomainError, ContainerRepository } from "./container-repository.mjs";
import { ReadDomainError, ReadRepository } from "./read-repository.mjs";
import {
  ProjectUpdateDomainError,
  ProjectUpdateRepository
} from "./project-update-repository.mjs";
import {
  ProjectActivityDomainError,
  ProjectActivityRepository
} from "./project-activity-repository.mjs";
import {
  TaskCompletionDomainError,
  TaskCompletionRepository
} from "./task-completion-repository.mjs";
import { TaskDomainError, TaskRepository } from "./task-repository.mjs";
import { configureToolProfile } from "./security-adapter.mjs";

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
const destinationContainerIdSchema = z.string({ error: "INVALID_DESTINATION_CONTAINER_ID" })
  .transform(value => value.trim())
  .pipe(z.string().min(1, "INVALID_DESTINATION_CONTAINER_ID"));
const moveTaskInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  taskId: taskIdSchema,
  expectedVersion: expectedVersionSchema,
  destinationContainerId: destinationContainerIdSchema
}).strict();
const moveTaskOutputSchema = z.object({
  replayed: z.boolean(),
  changed: z.boolean(),
  task: taskSchema
}).strict();
const exactReferenceTextSchema = z.string()
  .transform(value => value.trim())
  .pipe(z.string().min(1));
const resolveReferenceInputSchema = z.union([
  z.object({
    referenceType: z.literal("CONTAINER"),
    containerId: exactReferenceTextSchema
  }).strict(),
  z.object({
    referenceType: z.literal("CONTAINER"),
    name: exactReferenceTextSchema,
    parentContainerId: exactReferenceTextSchema.nullable()
  }).strict(),
  z.object({
    referenceType: z.literal("CONTAINER"),
    name: exactReferenceTextSchema,
    global: z.literal(true)
  }).strict(),
  z.object({
    referenceType: z.literal("TASK"),
    taskId: exactReferenceTextSchema
  }).strict(),
  z.object({
    referenceType: z.literal("TASK"),
    title: exactReferenceTextSchema,
    containerId: exactReferenceTextSchema
  }).strict(),
  z.object({
    referenceType: z.literal("TASK"),
    title: exactReferenceTextSchema,
    global: z.literal(true)
  }).strict()
]);
const referenceSchema = z.object({
  referenceType: z.enum(["CONTAINER", "TASK"]),
  id: z.string(),
  label: z.string(),
  containerId: z.string().nullable(),
  lifecycleState: z.enum(["ACTIVE", "ARCHIVED"])
}).strict();
const isoDateSchema = z.string().refine(value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "INVALID_AS_OF_DATE");
const briefingInputSchema = z.object({
  containerId: exactReferenceTextSchema.optional(),
  asOfDate: isoDateSchema,
  limit: z.number().int().min(1).max(50).default(20)
}).strict();
const briefingTaskSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string().nullable(),
  dueDate: z.string().nullable(),
  temporalState: z.enum(["OVERDUE", "DUE_TODAY", "FUTURE"]).nullable()
}).strict();
const taskCompletionInputSchema = z.object({
  taskId: taskIdSchema,
  expectedVersion: expectedVersionSchema,
  idempotencyKey: idempotencyKeySchema,
  transition: z.enum(["COMPLETE", "REOPEN"])
}).strict();
const timelineEventSchema = z.object({
  eventId: z.string(),
  containerId: z.string(),
  taskId: z.string().nullable(),
  type: z.string(),
  description: z.string(),
  origin: z.string(),
  occurredAt: z.string(),
  idempotencyOperation: z.string(),
  idempotencyKey: z.string()
}).strict();
const taskCompletionOutputSchema = z.object({
  replayed: z.boolean(),
  changed: z.boolean(),
  task: taskSchema,
  timelineEvent: timelineEventSchema.nullable()
}).strict();
const timelineLimitSchema = z.number().int().min(1).max(100).default(50);
const getTimelineInputSchema = z.union([
  z.object({
    containerId: moveContainerIdSchema,
    taskId: taskIdSchema.optional(),
    limit: timelineLimitSchema
  }).strict(),
  z.object({
    taskId: taskIdSchema,
    limit: timelineLimitSchema
  }).strict(),
  z.object({
    global: z.literal(true),
    limit: timelineLimitSchema
  }).strict()
]);
const coordinatedTaskInputSchema = z.object({
  title: requiredTaskTextSchema("INVALID_TASK_TITLE"),
  status: requiredTaskTextSchema("INVALID_TASK_STATUS"),
  description: optionalTaskTextSchema("INVALID_TASK_DESCRIPTION"),
  priority: optionalTaskTextSchema("INVALID_TASK_PRIORITY"),
  assignee: optionalTaskTextSchema("INVALID_TASK_ASSIGNEE"),
  dueDate: optionalTaskTextSchema("INVALID_TASK_DUE_DATE")
}).strict();
const coordinatedTransitionSchema = z.object({
  taskId: taskIdSchema,
  expectedVersion: expectedVersionSchema,
  transition: z.enum(["COMPLETE", "REOPEN"])
}).strict();
const coordinatedTransitionsSchema = z.array(coordinatedTransitionSchema).max(50)
  .refine(values => new Set(values.map(value => value.taskId)).size === values.length,
    "DUPLICATE_TASK_TRANSITION");
const coordinatedTimelineInputSchema = z.object({
  type: z.string().transform(value => value.trim()).pipe(z.string().min(1).max(64)),
  description: z.string().transform(value => value.trim()).pipe(z.string().min(1).max(2000))
}).strict();
const coordinatedProjectPatchSchema = z.object({
  name: updateRequiredTextSchema("INVALID_CONTAINER_NAME").optional(),
  status: updateRequiredTextSchema("INVALID_CONTAINER_STATUS").optional(),
  focus: updateNullableTextSchema("INVALID_CONTAINER_FOCUS").optional(),
  owner: updateNullableTextSchema("INVALID_CONTAINER_OWNER").optional(),
  nextAction: updateNullableTextSchema("INVALID_CONTAINER_NEXT_ACTION").optional()
}).strict();
const applyProjectUpdateInputSchema = z.object({
  projectId: moveContainerIdSchema,
  expectedProjectVersion: expectedVersionSchema,
  idempotencyKey: idempotencyKeySchema,
  projectPatch: coordinatedProjectPatchSchema.optional().default({}),
  newTasks: z.array(coordinatedTaskInputSchema).max(50).optional().default([]),
  taskTransitions: coordinatedTransitionsSchema.optional().default([]),
  timelineEvent: coordinatedTimelineInputSchema
}).strict();
const transitionedTaskSchema = z.object({
  transition: z.enum(["COMPLETE", "REOPEN"]),
  changed: z.boolean(),
  task: taskSchema
}).strict();
const applyProjectUpdateOutputSchema = z.object({
  replayed: z.boolean(),
  changed: z.boolean(),
  project: containerSchema,
  createdTasks: z.array(taskSchema),
  transitionedTasks: z.array(transitionedTaskSchema),
  timelineEvent: timelineEventSchema.nullable()
}).strict();
const activityModeSchema = z.enum(["COMPACT", "FULL", "KEYS"]);
const activityKeysSchema = z.array(z.string().transform(value => value.trim())
  .pipe(z.string().min(1))).min(1).max(100)
  .refine(keys => new Set(keys).size === keys.length, "INVALID_KEYS");
const getProjectActivityInputSchema = z.union([
  z.object({ activityId: exactReferenceTextSchema, projectId: moveContainerIdSchema.optional(),
    mode: z.enum(["COMPACT", "FULL"]).default("COMPACT") }).strict(),
  z.object({ activityId: exactReferenceTextSchema, projectId: moveContainerIdSchema.optional(),
    mode: z.literal("KEYS"), keys: activityKeysSchema }).strict(),
  z.object({ projectId: moveContainerIdSchema, name: exactReferenceTextSchema,
    mode: z.enum(["COMPACT", "FULL"]).default("COMPACT") }).strict(),
  z.object({ projectId: moveContainerIdSchema, name: exactReferenceTextSchema,
    mode: z.literal("KEYS"), keys: activityKeysSchema }).strict(),
  z.object({ name: exactReferenceTextSchema, global: z.literal(true),
    mode: z.enum(["COMPACT", "FULL"]).default("COMPACT") }).strict(),
  z.object({ name: exactReferenceTextSchema, global: z.literal(true),
    mode: z.literal("KEYS"), keys: activityKeysSchema }).strict()
]);
const activityCoreSchema = z.object({
  activityId:z.string(),projectId:z.string(),kind:z.string(),canonicalName:z.string(),
  status:z.string(),focus:z.string().nullable(),nextAction:z.string().nullable(),
  summary:z.string().nullable(),schemaVersion:z.number().int().positive(),
  snapshotVersion:z.number().int().positive(),createdAt:z.string(),updatedAt:z.string(),
  lastConsolidatedAt:z.string(),lastEventId:z.string().nullable()
}).strict();
const projectActivityOutputSchema = z.object({
  activityId:z.string(),projectId:z.string(),canonicalName:z.string(),
  schemaVersion:z.number().int().positive(),snapshotVersion:z.number().int().positive(),
  mode:activityModeSchema,activity:activityCoreSchema
}).passthrough();
const activityPatchSchema = z.object({
  set: z.object({ status:z.string().optional(),focus:z.string().optional(),
    nextAction:z.string().optional(),summary:z.string().optional() }).strict().default({}),
  clear: z.array(z.enum(["status","focus","nextAction","summary"])).max(4)
    .refine(values => new Set(values).size === values.length, "INVALID_PATCH").default([])
}).strict().refine(value => !value.clear.some(key => Object.hasOwn(value.set, key)),
  "INVALID_PATCH");
const activityItemSchema = z.discriminatedUnion("op", [
  z.object({ op:z.literal("UPSERT"),key:exactReferenceTextSchema,
    type:z.enum(["DECISION","CONTENT","TECHNICAL_CONTEXT"]).optional(),value:z.any(),
    reason:z.string().optional(),approvedAt:z.string().optional() }).strict(),
  z.object({ op:z.literal("DELETE"),key:exactReferenceTextSchema,
    reason:z.string().transform(value=>value.trim()).pipe(z.string().min(1)) }).strict()
]);
const activityItemsSchema = z.array(activityItemSchema).max(100)
  .refine(items => new Set(items.map(item=>item.key)).size===items.length,
    "INVALID_ITEM_OPERATION");
const activityAliasesSchema = z.object({
  add:z.array(exactReferenceTextSchema).max(50).default([]),
  remove:z.array(exactReferenceTextSchema).max(50).default([])
}).strict();
const updateProjectActivityInputSchema = z.object({
  projectId:moveContainerIdSchema,activityId:exactReferenceTextSchema.optional(),
  name:exactReferenceTextSchema.optional(),kind:exactReferenceTextSchema.optional(),
  createIfMissing:z.boolean().default(false),expectedSnapshotVersion:z.number().int().nonnegative(),
  idempotencyKey:idempotencyKeySchema,patch:activityPatchSchema.default({set:{},clear:[]}),
  items:activityItemsSchema.default([]),aliases:activityAliasesSchema.default({add:[],remove:[]}),
  source:exactReferenceTextSchema.default("API"),
  timelineEvent:z.object({description:z.string().transform(value=>value.trim())
    .pipe(z.string().min(1).max(2000))}).strict().optional()
}).strict().refine(value => Boolean(value.activityId||value.name), "ACTIVITY_NOT_FOUND")
  .refine(value => !value.createIfMissing || Boolean(value.name&&value.kind), "INVALID_PATCH");
const updateProjectActivityOutputSchema = z.object({
  replayed:z.boolean(),created:z.boolean(),noOp:z.boolean(),activityId:z.string(),
  projectId:z.string(),snapshotVersion:z.number().int().positive(),
  changedKeys:z.array(z.string()),timelineEvent:timelineEventSchema.nullable(),
  snapshot:projectActivityOutputSchema
}).strict();
const toolErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    details: z.unknown().optional()
  }).strict()
}).strict();

export function createDeskMcpServer(env, options = {}) {
  const server = configureToolProfile(
    new McpServer({ name: "desk-v2-capability-test", version: "0.1.0" }),
    options.profile
  );
  const repository = new CapabilityRepository(env.DESK_V2_DB);
  const containerRepository = new ContainerRepository(env.DESK_V2_DB);
  const taskRepository = new TaskRepository(env.DESK_V2_DB);
  const readRepository = new ReadRepository(env.DESK_V2_DB);
  const taskCompletionRepository = new TaskCompletionRepository(env.DESK_V2_DB);
  const projectUpdateRepository = new ProjectUpdateRepository(env.DESK_V2_DB);
  const projectActivityRepository = new ProjectActivityRepository(env.DESK_V2_DB);

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
    "desk_v2_move_task",
    {
      title: "Move Desk V2 Task",
      description: "Moves one active Task between active Containers while preserving its identity and domain fields. Requires optimistic concurrency and an idempotency key.",
      inputSchema: moveTaskInputSchema,
      outputSchema: z.union([moveTaskOutputSchema, toolErrorSchema]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await taskRepository.moveTask(input));
      } catch (error) {
        if (error instanceof TaskDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The Task could not be moved.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_resolve_reference",
    {
      title: "Resolve a Desk V2 reference",
      description: "Resolves exactly one persisted Container or Task by stable ID, exact name/title within an explicit scope, or exact global search when explicitly requested. It does not use fuzzy or Unicode-normalized matching, Timeline, Workspace, or ProjectActivity.",
      inputSchema: resolveReferenceInputSchema,
      outputSchema: z.union([z.object({ reference: referenceSchema }).strict(), toolErrorSchema]),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await readRepository.resolveReference(input));
      } catch (error) {
        if (error instanceof ReadDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The reference could not be resolved.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_get_briefing",
    {
      title: "Get a Desk V2 Container briefing",
      description: "Reads a bounded briefing from one explicit active Container and its active Tasks. The caller supplies the calendar date used for dynamic due-date classification because no implicit Workspace timezone is assumed.",
      inputSchema: briefingInputSchema,
      outputSchema: z.union([z.object({
        asOfDate: isoDateSchema,
        scope: z.object({
          containerId: z.string(),
          parentId: z.string().nullable(),
          name: z.string(),
          status: z.string(),
          focus: z.string().nullable(),
          nextAction: z.string().nullable(),
          lifecycleState: z.literal("ACTIVE")
        }).strict(),
        counts: z.object({
          activeTasks: z.number().int().nonnegative(),
          byStatus: z.record(z.string(), z.number().int().nonnegative())
        }).strict(),
        taskLimit: z.number().int().positive(),
        truncated: z.boolean(),
        tasks: z.array(briefingTaskSchema)
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
        return result(await readRepository.getBriefing(input));
      } catch (error) {
        if (error instanceof ReadDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The briefing could not be read.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_set_task_completion",
    {
      title: "Set Desk V2 Task completion",
      description: "Completes or reopens one active Task in an active Container with optimistic concurrency and idempotency. A real transition atomically appends exactly one Timeline event; a no-op appends none.",
      inputSchema: taskCompletionInputSchema,
      outputSchema: z.union([taskCompletionOutputSchema, toolErrorSchema]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await taskCompletionRepository.setTaskCompletion(input));
      } catch (error) {
        if (error instanceof TaskCompletionDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED",
          "The Task completion could not be changed.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_get_timeline",
    {
      title: "Get Desk V2 Timeline",
      description: "Reads bounded append-only Desk V2 Timeline events by explicit Container or Task scope, or globally only when explicitly requested. Timeline is not ProjectActivity memory.",
      inputSchema: getTimelineInputSchema,
      outputSchema: z.union([z.object({
        scope: z.enum(["CONTAINER", "TASK", "GLOBAL"]),
        containerId: z.string().nullable(),
        taskId: z.string().nullable(),
        limit: z.number().int().positive(),
        count: z.number().int().nonnegative(),
        events: z.array(timelineEventSchema)
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
        return result(await taskCompletionRepository.getTimeline(input));
      } catch (error) {
        if (error instanceof TaskCompletionDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED", "The Timeline could not be read.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_apply_project_update",
    {
      title: "Apply a coordinated Desk V2 Project update",
      description: "Atomically patches one existing active Project Container, creates Tasks, completes or reopens scoped Tasks, stores one idempotency receipt, and appends exactly one Timeline event when domain data changes. It never writes ProjectActivity.",
      inputSchema: applyProjectUpdateInputSchema,
      outputSchema: z.union([applyProjectUpdateOutputSchema, toolErrorSchema]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(await projectUpdateRepository.applyProjectUpdate(input));
      } catch (error) {
        if (error instanceof ProjectUpdateDomainError) {
          return errorResult(error.code, error.message, error.retryable);
        }
        return errorResult("D1_OPERATION_FAILED",
          "The coordinated Project update failed atomically.", true);
      }
    }
  );

  server.registerTool(
    "desk_v2_get_project_activity",
    {
      title: "Get Desk V2 ProjectActivity",
      description: "Reads the current versioned ProjectActivity snapshot by stable ID, exact normalized name or alias within a known Project, or an explicitly requested globally unique alias. Timeline is never scanned as current memory.",
      inputSchema: getProjectActivityInputSchema,
      outputSchema: z.union([projectActivityOutputSchema, toolErrorSchema]),
      annotations: { readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false }
    },
    async input => {
      try { return result(await projectActivityRepository.getProjectActivity(input)); }
      catch (error) {
        if (error instanceof ProjectActivityDomainError) {
          return errorResult(error.code,error.message,error.retryable,error.details);
        }
        return errorResult("D1_OPERATION_FAILED","ProjectActivity could not be read.",true);
      }
    }
  );

  server.registerTool(
    "desk_v2_update_project_activity",
    {
      title: "Update Desk V2 ProjectActivity",
      description: "Atomically creates or updates approved ProjectActivity memory, stable-key items, revisions, aliases, one idempotency receipt, and exactly one Timeline event for a real mutation. It never creates Projects and never records assistant brainstorming implicitly.",
      inputSchema: updateProjectActivityInputSchema,
      outputSchema: z.union([updateProjectActivityOutputSchema,toolErrorSchema]),
      annotations: { readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false }
    },
    async input => {
      try { return result(await projectActivityRepository.updateProjectActivity(input)); }
      catch (error) {
        if (error instanceof ProjectActivityDomainError) {
          return errorResult(error.code,error.message,error.retryable,error.details);
        }
        return errorResult("D1_OPERATION_FAILED","ProjectActivity update failed atomically.",true);
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

function errorResult(code, message, retryable, details = undefined) {
  const error = { code, message, retryable };
  if (details !== undefined) error.details = details;
  const value = { error };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value
  };
}
