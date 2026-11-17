import { getStore } from "@/lib/store";
import { ok, failure } from "@/lib/server";
export async function GET() {
  try {
    return ok(await getStore());
  } catch (e) {
    return failure(e);
  }
}
