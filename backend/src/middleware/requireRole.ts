import type { Context, Next } from "hono";
import { getUserById, type UserRole } from "../db/userRepository.ts";
import { getOwnerId } from "./owner.ts";
import { recordAudit } from "../db/auditRepository.ts";

// Type-augment Hono so c.get("role") is typed UserRole instead of unknown.
declare module "hono" {
  interface ContextVariableMap {
    role: UserRole;
  }
}

// PR-8 role guard. Reads c.get("ownerId") (set by ownerContext, eventually by
// the JWT auth middleware in PR-9) and looks up the user's role in the DB.
// Until PR-9 wires real auth, owner === actor === current user, so this maps
// cleanly to the desktop "local" user.
//
// On 403 we record an audit event (`auth.denied`) so an admin reviewing the
// audit log later sees that someone tried to reach an admin surface without
// the right role. Suspended users also fail closed — status === "active" is
// required.
export function requireRole(...allowed: UserRole[]) {
  if (allowed.length === 0) {
    throw new Error("requireRole: at least one role must be specified");
  }
  return async (c: Context, next: Next): Promise<Response | void> => {
    const userId = getOwnerId(c);
    const user = getUserById(userId);

    if (user === null) {
      recordAudit(c, "auth.denied", {
        outcome: "denied",
        detail: { reason: "user_not_found", userId, required: allowed },
      });
      return c.json(
        { error: { code: "unauthorized", message: "User not found" } },
        401,
      );
    }

    if (user.status !== "active") {
      recordAudit(c, "auth.denied", {
        outcome: "denied",
        detail: { reason: "user_inactive", userId, status: user.status, required: allowed },
      });
      return c.json(
        { error: { code: "forbidden", message: "Account is not active" } },
        403,
      );
    }

    if (!allowed.includes(user.role)) {
      recordAudit(c, "auth.denied", {
        outcome: "denied",
        detail: { reason: "role_mismatch", userId, role: user.role, required: allowed },
      });
      return c.json(
        { error: { code: "forbidden", message: "Insufficient role" } },
        403,
      );
    }

    c.set("role", user.role);
    await next();
  };
}
