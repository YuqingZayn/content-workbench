import { DatabaseSync } from "node:sqlite";
import type { Job, AiRun } from "../contracts/model";
import {AppError} from '../services/files';
export class StateDatabase {
  db: DatabaseSync;
  constructor(file: string, readOnly = false) {
    this.db = new DatabaseSync(file, { readOnly });
    const version = this.db.prepare('PRAGMA user_version').get() as {user_version:number};
    if(version.user_version > 1) { this.db.close(); throw new AppError('SCHEMA_UNSUPPORTED', '数据库版本较新，原文件已保留，请使用兼容版本'); }
    if (!readOnly) {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(content_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,thread_id TEXT NOT NULL);
    PRAGMA user_version=1;`);
    }
  }
  list<T extends Job | AiRun>(table: "jobs" | "runs", projectId: string): T[] {
    return (
      this.db
        .prepare(
          `SELECT payload FROM ${table} WHERE project_id=? ORDER BY rowid DESC`,
        )
        .all(projectId) as { payload: string }[]
    ).map((x) => JSON.parse(x.payload));
  }
  put(table: "jobs" | "runs", value: Job | AiRun) {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,project_id,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`,
      )
      .run(value.id, value.projectId, JSON.stringify(value));
  }
  session(projectId: string, contentId: string) {
    return (
      this.db
        .prepare(
          "SELECT thread_id FROM sessions WHERE project_id=? AND content_id=?",
        )
        .get(projectId, contentId) as { thread_id: string } | undefined
    )?.thread_id;
  }
  setSession(projectId: string, contentId: string, threadId: string) {
    this.db
      .prepare(
        "INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(content_id) DO UPDATE SET thread_id=excluded.thread_id",
      )
      .run(contentId, projectId, threadId);
  }
  close() {
    this.db.close();
  }
}
