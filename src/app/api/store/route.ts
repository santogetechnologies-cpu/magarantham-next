import { getStore } from "@/lib/store";
import { ok, failure } from "@/lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET() {
  try {
    return ok(await getStore());
  } catch (e) {
    return failure(e);
  }
}
