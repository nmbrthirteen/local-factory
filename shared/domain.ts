export const workingStates = ['preparing', 'running', 'checking', 'canceling'] as const;
export const activeStates = [...workingStates, 'awaiting_approval'] as const;
export const finishedStates = ['handoff', 'failed', 'canceled', 'interrupted'] as const;
export const harnesses = ['codex', 'claude', 'opencode'] as const;
export const autonomyLevels = ['ask', 'sandboxed', 'full'] as const;

export type WorkingState = (typeof workingStates)[number];
export type ActiveState = (typeof activeStates)[number];
export type FinishedState = (typeof finishedStates)[number];
export type TaskStatus = 'queued' | ActiveState | FinishedState;
export type Harness = (typeof harnesses)[number];
export type Autonomy = (typeof autonomyLevels)[number];

const oneOf = <T extends string>(values: readonly T[]) => (value: unknown): value is T => values.includes(value as T);

export const isWorking = oneOf(workingStates);
export const isActive = oneOf(activeStates);
export const isFinished = oneOf(finishedStates);
export const isHarness = oneOf(harnesses);
export const isAutonomy = oneOf(autonomyLevels);
