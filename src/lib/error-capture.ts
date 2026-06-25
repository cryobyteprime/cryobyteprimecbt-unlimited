let lastError: unknown;

if (typeof process !== "undefined" && process?.on) {
  process.on?.("unhandledRejection", (err: unknown) => {
    lastError = err;
  });
  process.on?.("uncaughtException", (err: unknown) => {
    lastError = err;
  });
}

export function consumeLastCapturedError(): unknown {
  const e = lastError;
  lastError = undefined;
  return e;
}