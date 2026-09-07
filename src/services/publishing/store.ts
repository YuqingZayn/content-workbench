import path from "node:path";
import { existsSync } from "node:fs";
import { AppError, readJson, writeJson } from "../files";
import type {
  PublishConnection,
  PublishSecrets,
} from "../../contracts/automation";
export interface SecretCodec {
  encrypt(text: string): string;
  decrypt(text: string): string;
}
// Only encrypted ciphertext is persisted. This directory belongs to application user data,
// outside business project snapshots, exports, and backups.
export class ConnectionStore {
  constructor(
    public directory: string,
    private codec: SecretCodec,
  ) {}
  all(): PublishConnection[] {
    const f = path.join(this.directory, "connections.json");
    return existsSync(f) ? readJson<PublishConnection[]>(f) : [];
  }
  save(value: PublishConnection) {
    writeJson(path.join(this.directory, "connections.json"), [
      ...this.all().filter((c) => c.id !== value.id),
      value,
    ]);
  }
  secrets(id: string): PublishSecrets {
    const f = path.join(this.directory, "credentials.json");
    const records = existsSync(f) ? readJson<Record<string, string>>(f) : {};
    if (!records[id]) return {};
    try {
      return JSON.parse(this.codec.decrypt(records[id]));
    } catch {
      throw new AppError(
        "CREDENTIALS_UNAVAILABLE",
        "本机凭据无法解密，请重新填写连接信息",
      );
    }
  }
  hasSecrets(id: string) {
    const f = path.join(this.directory, "credentials.json");
    return existsSync(f) && !!readJson<Record<string, string>>(f)[id];
  }
  setSecrets(id: string, value: PublishSecrets) {
    const f = path.join(this.directory, "credentials.json");
    const records = existsSync(f) ? readJson<Record<string, string>>(f) : {};
    records[id] = this.codec.encrypt(JSON.stringify(value));
    writeJson(f, records);
  }
  removeSecrets(id: string) {
    const f = path.join(this.directory, "credentials.json");
    if (!existsSync(f)) return;
    const records = readJson<Record<string, string>>(f);
    delete records[id];
    writeJson(f, records);
  }
}
