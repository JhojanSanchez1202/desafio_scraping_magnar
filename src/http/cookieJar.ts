/**
 * Cookie jar manual: axios no persiste cookies solo entre requests.
 * No hace falta tough-cookie para esto: guardamos name=value en un Map y
 * lo mandamos siempre como header Cookie.
 */
export class CookieJar {
  private cookies = new Map<string, string>();

  /** Parsea los `Set-Cookie` de una respuesta y actualiza el jar. */
  update(setCookieHeaders: string[] | undefined): void {
    if (!setCookieHeaders) return;
    for (const raw of setCookieHeaders) {
      const pair = raw.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  /**
   * Header `Cookie` listo para mandar, o `undefined` si todavía no hay
   * cookies. El WAF del sitio bloquea la request si mandamos `Cookie: ""`
   * vacío en el primer request (lo confirmamos en pruebas reales) — mejor
   * no mandar el header en absoluto en ese caso.
   */
  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}
