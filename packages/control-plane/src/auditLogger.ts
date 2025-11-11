import fs from 'node:fs';

interface LoggerLike {
  info: (obj: Record<string, unknown>, msg?: string) => void;
}

interface AuditLoggerOptions {
  enabled: boolean;
  path?: string;
  logger: LoggerLike;
}

export interface AuditLogger {
  log: (event: string, payload: Record<string, unknown>) => void;
  close: () => void;
}

export const createAuditLogger = ({ enabled, path, logger }: AuditLoggerOptions): AuditLogger => {
  if (!enabled) {
    return {
      log: () => {},
      close: () => {}
    };
  }

  const stream = path ? fs.createWriteStream(path, { flags: 'a' }) : null;

  const log = (event: string, payload: Record<string, unknown>) => {
    const entry = {
      ts: Date.now(),
      event,
      ...payload
    };
    logger.info({ audit: entry }, `audit:${event}`);
    if (stream) {
      stream.write(JSON.stringify(entry) + '\n');
    }
  };

  const close = () => {
    if (stream) {
      stream.end();
    }
  };

  return { log, close };
};
