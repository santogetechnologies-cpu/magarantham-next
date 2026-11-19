export async function api<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
  form?: FormData | string,
): Promise<T> {
  const method =
    typeof form === "string"
      ? form
      : data !== undefined || form
        ? "POST"
        : "GET";
  const body =
    form && typeof form !== "string"
      ? form
      : data !== undefined
        ? JSON.stringify(data)
        : undefined;

  const res = await fetch(path, {
    method,
    headers:
      form && typeof form !== "string"
        ? undefined
        : data !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
    body,
    cache: "no-store",
  });
  const result = await res.json();
  if (!res.ok) {
    const e = new Error(result.message || result.error || "Please try again.");
    Object.assign(e, { code: result.error, status: res.status });
    throw e;
  }
  return result;
}
