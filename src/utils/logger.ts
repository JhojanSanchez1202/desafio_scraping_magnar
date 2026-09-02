/** Logger mínimo: timestamp + nivel + mensaje. No hace falta Winston/Pino para esto. */

type Level = "info" | "warn" | "error";

function log(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
  const out = level === "error" ? console.error : console.log;
  out(ctx ? `${line} ${JSON.stringify(ctx)}` : line);
}

export const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => log("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log("error", msg, ctx),
};
