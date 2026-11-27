import { completeOAuth } from "../../complete-oauth";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return completeOAuth(request, "github");
}
