/** 旧 SSE トランスポート用のインメモリセッション（同一 Worker インスタンス内のみ有効） */
export type SseSession = {
  write: (chunk: string) => Promise<void>;
  close: () => void;
};

const sseSessions = new Map<string, SseSession>();

export function getSseSession(sessionId: string): SseSession | undefined {
  return sseSessions.get(sessionId);
}

export function registerSseSession(
  sessionId: string,
  session: SseSession
): void {
  sseSessions.set(sessionId, session);
}

export function removeSseSession(sessionId: string): void {
  sseSessions.delete(sessionId);
}
