export interface AgentTask {
  taskId: string
  taskType: string
  label: string
  sourceHash: string
  input: unknown
  target: Record<string, string>
  status: string
  migrated?: boolean
}
export interface AgentTaskStore {
  list(): AgentTask[]
  put(task: AgentTask): AgentTask
  receive(raw: string, apply: (task: AgentTask, payload: Record<string, unknown>, hash: string) => Promise<string>, selectedTaskId?: string): Promise<unknown>
}
export interface AgentProtocol {
  create(options: { taskType: string; label: string; input: unknown; instructions: string; target: Record<string, string> }): Promise<AgentTask>
  createStore(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }, key: string, budget?: number): AgentTaskStore
  hash(value: unknown): Promise<string>
  parse(raw: string): AgentTask
}
declare global {
  interface Window {
    AgentHandoffProtocol: AgentProtocol
    AgentTaskWorkspace?: { ready: Promise<void>; getStore(): AgentTaskStore; flush(): Promise<void>; migrate(tasks: AgentTask[]): Promise<void>; register(type: string, route: { apply: (task: AgentTask, payload: Record<string, unknown>, hash: string) => Promise<string>; accept?: (task: AgentTask, payload: Record<string, unknown>, hash: string) => Promise<string> }): void }
    AgentHandoffPanel: { open(options: { title: string; description: string; taskType: string; initialRaw?: string; initialError?: string; store: AgentTaskStore; createTask: () => Promise<AgentTask>; apply: (task: AgentTask, payload: Record<string, unknown>, hash: string) => Promise<string>; accept?: (task: AgentTask, payload: Record<string, unknown>, hash: string) => Promise<string>; rebind?: (task: AgentTask) => Promise<string> }): void }
  }
}
