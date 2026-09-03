import fs from "fs";
import path from "path";
import { config } from "../config";

fs.mkdirSync(config.paths.logsDir, { recursive: true });
const logFile = path.join(config.paths.logsDir, `run-${Date.now()}.log`);

function write(level: string, msg: string, meta?: unknown) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}${meta ? " " + JSON.stringify(meta) : ""}`;
  console.log(line);
  fs.appendFileSync(logFile, line + "\n");
}

export const logger = {
  info: (msg: string, meta?: unknown) => write("INFO", msg, meta),
  warn: (msg: string, meta?: unknown) => write("WARN", msg, meta),
  error: (msg: string, meta?: unknown) => write("ERROR", msg, meta),
  progress: (current: number, total: number, label: string) => write("INFO", `${label}: ${current}/${total}`),
};
