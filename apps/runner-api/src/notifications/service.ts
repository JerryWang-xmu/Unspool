import { randomUUID } from "node:crypto";

export type NotificationType =
  | "approval"
  | "handoff"
  | "mention"
  | "completion"
  | "failure"
  | "needs_confirmation";
export interface NotificationRecord {
  readonly id: string;
  readonly type: NotificationType;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly title: string;
  readonly body?: string;
  readonly visibility: "workspace_members" | "private";
  readonly recipientIds?: readonly string[];
  readonly createdAt: string;
  readonly readAt?: string;
}

export class NotificationService {
  readonly #records: NotificationRecord[] = [];
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  publish(input: Omit<NotificationRecord, "id" | "createdAt" | "readAt">): NotificationRecord {
    if (input.title.trim().length === 0) throw new TypeError("Notification title is required");
    const record = { ...input, id: randomUUID(), createdAt: this.#now().toISOString() };
    this.#records.push(record);
    return record;
  }

  list(workspaceId: string, actorId: string): NotificationRecord[] {
    return this.#records.filter(
      (record) =>
        record.workspaceId === workspaceId &&
        (record.visibility === "workspace_members" ||
          record.recipientIds?.includes(actorId) === true),
    );
  }

  markRead(notificationId: string, actorId: string): NotificationRecord {
    const record = this.#records.find((candidate) => candidate.id === notificationId);
    if (record === undefined) throw new Error("notification_not_found");
    if (record.visibility === "private" && !record.recipientIds?.includes(actorId))
      throw new Error("permission_denied");
    const updated = { ...record, readAt: this.#now().toISOString() };
    this.#records[this.#records.indexOf(record)] = updated;
    return updated;
  }
}
