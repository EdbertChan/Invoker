import type { AgentSessionData } from '@invoker/contracts';
import type { AgentRegistry } from '@invoker/execution-engine';

export async function resolveAgentSession(
  sessionId: string,
  agentName: string,
  registry?: AgentRegistry,
  allTasks?: import('@invoker/workflow-core').TaskState[],
): Promise<AgentSessionData | null> {
  const driver = registry?.getSessionDriver(agentName);
  if (!driver) {
    return {
      agentName,
      sessionId,
      state: 'error',
      messages: [],
      reason: `No session driver registered for agent "${agentName}"`,
    };
  }

  // 1. Try local
  const raw = driver.loadSession(sessionId);
  if (raw) {
    const inspection = driver.inspectSession(raw);
    return {
      agentName,
      sessionId,
      state: inspection.state,
      reason: inspection.reason,
      messages: driver.parseSession(raw),
      source: 'local',
    };
  }

  // 2. Try remote (SSH tasks)
  if (driver.fetchRemoteSession && allTasks) {
    const sshTask = allTasks.find(
      t => t.execution.agentSessionId === sessionId
        && t.config.runnerKind === 'ssh',
    );
    if (sshTask) {
      const { loadConfig } = await import('./config.js');
      const targets = loadConfig().remoteTargets ?? {};
      const targetId = (sshTask.config as { poolMemberId?: string }).poolMemberId;
      const target = targetId
        ? targets[targetId]
        : Object.values(targets)[0];
      if (target) {
        const remoteRaw = await driver.fetchRemoteSession(sessionId, target);
        if (remoteRaw) {
          const inspection = driver.inspectSession(remoteRaw);
          return {
            agentName,
            sessionId,
            state: inspection.state,
            reason: inspection.reason,
            messages: driver.parseSession(remoteRaw),
            source: 'remote',
          };
        }
      }
    }
  }

  return {
    agentName,
    sessionId,
    state: 'error',
    messages: [],
    reason: 'Session file not found',
  };
}


