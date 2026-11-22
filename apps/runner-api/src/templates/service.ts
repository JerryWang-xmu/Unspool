import { randomUUID } from "node:crypto";

export interface TaskTemplate {
  readonly id: string;
  readonly name: string;
  readonly goal: string;
  readonly context: readonly { title: string; body: string }[];
  readonly approvalPolicy: { required: boolean; approverIds: readonly string[] };
}

export class TemplateService {
  readonly #templates = new Map<string, TaskTemplate>();

  create(input: Omit<TaskTemplate, "id">): TaskTemplate {
    if (input.name.trim().length === 0 || input.goal.trim().length === 0)
      throw new TypeError("Template name and goal are required");
    if (input.approvalPolicy.required && input.approvalPolicy.approverIds.length === 0)
      throw new TypeError("A required approval needs at least one approver");
    const template = { ...input, id: randomUUID() };
    this.#templates.set(template.id, template);
    return template;
  }

  get(templateId: string): TaskTemplate {
    const template = this.#templates.get(templateId);
    if (template === undefined) throw new Error("template_not_found");
    return template;
  }

  instantiate(templateId: string): TaskTemplate {
    return structuredClone(this.get(templateId));
  }
}
