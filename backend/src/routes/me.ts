import { Hono } from "hono";
import { getUserById } from "../db/userRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { fail, ok } from "../util/envelope.ts";

// GET /api/v1/me — returns the current user's profile (id, email, role, status,
// displayName). Frontend uses this to decide whether to render the Admin
// sidebar section. Until PR-9 wires real auth, getOwnerId returns 'local' and
// the seeded `users.local` row is what comes back; PR-9 swaps this for the
// JWT-derived user id.

export const meRouter = new Hono();

meRouter.get("/", (c) => {
  const userId = getOwnerId(c);
  const user = getUserById(userId);
  if (user === null) {
    return c.json(fail("unauthorized", "Utilizator inexistent", c), 401);
  }
  return c.json(
    ok(
      {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      },
      c,
    ),
    200,
  );
});
