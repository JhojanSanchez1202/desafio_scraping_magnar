import { PjeScraper } from "./scraper/PjeScraper";
import { RunMode } from "./types";
import { logger } from "./utils/logger";

function parseMode(): RunMode {
  const arg = process.argv.find((a) => a.startsWith("--mode="));
  const mode = (arg ? arg.split("=")[1] : "full") as RunMode;
  if (!["scrape", "download", "retry", "full"].includes(mode)) {
    throw new Error(`Modo inválido: ${mode}. Usar --mode=scrape|download|retry|full`);
  }
  return mode;
}

async function main() {
  const mode = parseMode();
  const scraper = new PjeScraper();

  logger.info(`Iniciando en modo: ${mode}`);

  if (mode === "scrape") await scraper.scrape();
  else if (mode === "download") await scraper.download();
  else if (mode === "retry") await scraper.retry();
  else await scraper.run();

  logger.info("Ejecución finalizada.");
}

main().catch((err) => {
  logger.error("Error fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
