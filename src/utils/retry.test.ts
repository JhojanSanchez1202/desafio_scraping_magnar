/** Self-check mínimo de withBackoff: sin framework, corre con `npm test`. */
import { withBackoff } from "./retry";

async function main() {
  // caso 1: reintenta hasta que funciona, contando los intentos
  let calls = 0;
  const result = await withBackoff(
    async () => {
      calls++;
      if (calls < 3) throw new Error("429");
      return "ok";
    },
    { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 5, isRetryable: () => true }
  );
  console.assert(result === "ok", "esperaba que reintente hasta tener éxito");
  console.assert(calls === 3, `esperaba 3 llamadas, hubo ${calls}`);

  // caso 2: agota reintentos y relanza el error original
  let attempts = 0;
  await withBackoff(
    async () => {
      attempts++;
      throw new Error("siempre falla");
    },
    { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5, isRetryable: () => true }
  ).then(
    () => {
      throw new Error("no debería haber resuelto");
    },
    (err) => {
      console.assert(attempts === 3, `esperaba 3 intentos (1 + 2 retries), hubo ${attempts}`);
      console.assert(err.message === "siempre falla", "debe relanzar el error original");
    }
  );

  // caso 3: error no reintentable corta al primer intento
  let attemptsNonRetryable = 0;
  await withBackoff(
    async () => {
      attemptsNonRetryable++;
      throw new Error("no reintentable");
    },
    { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 5, isRetryable: () => false }
  ).then(
    () => {
      throw new Error("no debería haber resuelto");
    },
    () => {
      console.assert(attemptsNonRetryable === 1, `esperaba 1 intento, hubo ${attemptsNonRetryable}`);
    }
  );

  console.log("retry.test.ts OK");
}

main().catch((err) => {
  console.error("retry.test.ts FALLÓ", err);
  process.exit(1);
});
