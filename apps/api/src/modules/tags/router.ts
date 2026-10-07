import { Router } from "express";
import { z } from "zod";
import { getOwnedTag } from "../../lib/access";
import { asyncHandler, sendData } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { currentUser, requireAuth } from "../../middleware/auth";
import { validate, validatedBody, validatedParams } from "../../middleware/validate";

export const tagRouter = Router();

const createTagSchema = z.object({
  name: z.string().trim().min(1).max(20),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#B0793A"),
});

tagRouter.use(requireAuth);

tagRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const tags = await prisma.tag.findMany({
      where: { ownerId: currentUser(req).id },
      include: { _count: { select: { observations: true } } },
      orderBy: { name: "asc" },
    });
    sendData(res, tags);
  }),
);

tagRouter.post(
  "/",
  validate({ body: createTagSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<{ name: string; color: string }>(req);
    const tag = await prisma.tag.upsert({
      where: { ownerId_name: { ownerId: currentUser(req).id, name: input.name } },
      update: { color: input.color },
      create: { ownerId: currentUser(req).id, name: input.name, color: input.color },
    });
    sendData(res, tag, undefined, 201);
  }),
);

tagRouter.delete(
  "/:id",
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    await getOwnedTag(currentUser(req).id, id);
    await prisma.tag.delete({ where: { id } });
    sendData(res, { ok: true });
  }),
);
