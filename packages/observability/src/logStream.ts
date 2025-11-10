import { Subject } from 'rxjs';

export interface LogEntry {
  id: string;
  t: number;
  level: string;
  name: string;
  msg: string;
  data?: Record<string, unknown>;
}

const logSubject = new Subject<LogEntry>();

export const logStream$ = logSubject.asObservable();

export const publishLogEntry = (entry: LogEntry) => {
  logSubject.next(entry);
};
