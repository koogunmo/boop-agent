interface LogEntry {
  _id: string;
  logType: string;
  content: string;
  toolName?: string;
  accounts?: string[];
}

export function mergeTextLogs(logs: LogEntry[]): LogEntry[] {
  const result: LogEntry[] = [];
  let pending: LogEntry | null = null;

  for (const log of logs) {
    if (log.logType === "text") {
      if (pending) {
        pending.content += log.content;
      } else {
        pending = Object.assign({}, log);
      }
    } else {
      if (pending) {
        result.push(pending);
        pending = null;
      }
      result.push(log);
    }
  }
  if (pending) result.push(pending);
  return result;
}
