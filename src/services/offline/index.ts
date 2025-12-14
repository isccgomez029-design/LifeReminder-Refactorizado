// src/services/offline/index.ts
// ✅ SIMPLIFICADO: Solo SyncQueueService

export { syncQueueService } from "./SyncQueueService";

export type {
  QueueItem,
  QueueItemStatus,
  OperationType,
  SyncResult,
  SyncStats,
  CachedData,
  CachedCollection,
} from "./SyncQueueService";

export { default } from "./SyncQueueService";
