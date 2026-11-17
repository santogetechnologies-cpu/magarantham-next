export async function api<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
  form?: FormData,
): Promise<T> {
  const res = await fetch(path, {
    method: data !== undefined || form ? "POST" : "GET",
    headers: form
      ? undefined
      : data !== undefined
        ? { "Content-Type": "application/json" }
        : undefined,
    body: form || (data !== undefined ? JSON.stringify(data) : undefined),
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
