import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("请输入合法的邮箱地址")
  .max(120, "邮箱过长");

export const passwordSchema = z
  .string()
  .min(10, "密码至少 10 位")
  .max(72, "密码不能超过 72 位")
  .regex(/[a-z]/, "密码需要包含小写字母")
  .regex(/[A-Z]/, "密码需要包含大写字母")
  .regex(/\d/, "密码需要包含数字");

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1, "请填写昵称").max(40, "昵称过长"),
  })
  .refine((data) => data.password.toLowerCase() !== data.email, {
    message: "密码不能与邮箱相同",
    path: ["password"],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码").max(72),
});

export const updateMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    currentPassword: z.string().min(1).max(72).optional(),
    newPassword: passwordSchema.optional(),
  })
  .refine((data) => !data.newPassword || Boolean(data.currentPassword), {
    message: "修改密码需要提供当前密码",
    path: ["currentPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
