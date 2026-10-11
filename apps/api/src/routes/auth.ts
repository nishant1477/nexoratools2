import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError } from '@nexora/shared';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../lib/password.js';
import { signSession } from '../lib/session.js';
import { publicUser } from '../lib/serialize.js';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10, 'Password must be at least 10 characters').max(128);

const registerBody = z.object({ email, password, name: z.string().trim().min(1).max(80) });
const loginBody = z.object({ email, password: z.string().min(1).max(128) });
const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });

export default async function authRoutes(app: FastifyInstance) {
  const { env, prisma } = app.ctx;
  const authLimit = { rateLimit: { max: env.AUTH_RATE_LIMIT, timeWindow: env.AUTH_RATE_WINDOW_SECONDS * 1000 } };

  async function startSession(reply: FastifyReply, userId: string, tokenVersion: number) {
    const token = await signSession({ sub: userId, tv: tokenVersion }, env.JWT_SECRET, env.SESSION_TTL_HOURS);
    reply.setCookie(env.SESSION_COOKIE_NAME, token, {
      httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, path: '/', maxAge: env.SESSION_TTL_HOURS * 3600,
    });
  }

  app.post('/auth/register', { config: authLimit }, async (req, reply) => {
    const body = registerBody.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (exists) throw new AppError('EMAIL_TAKEN');
    const passwordHash = await hashPassword(body.password);
    try {
      const user = await prisma.user.create({ data: { email: body.email, name: body.name, passwordHash } });
      await startSession(reply, user.id, user.tokenVersion);
      return reply.code(201).send({ ok: true, data: { user: publicUser(user) } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new AppError('EMAIL_TAKEN'); // race on unique email
      throw err;
    }
  });

  app.post('/auth/login', { config: authLimit }, async (req, reply) => {
    const body = loginBody.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Always run a hash comparison so response time doesn't reveal whether the email exists.
    const valid = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new AppError('INVALID_CREDENTIALS');
    if (user.disabledAt) throw new AppError('ACCOUNT_DISABLED');
    await startSession(reply, user.id, user.tokenVersion);
    return { ok: true, data: { user: publicUser(user) } };
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true, data: {} };
  });

  app.get('/me', { preHandler: app.requireUser }, async (req) => ({ ok: true, data: { user: publicUser(req.user!) } }));

  app.post('/me/password', { preHandler: app.requireUser }, async (req, reply) => {
    const body = changePasswordBody.parse(req.body);
    const user = req.user!;
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect.');
    const updated = await prisma.user.update({
      where: { id: user.id },
      // Bumping tokenVersion signs out every other session.
      data: { passwordHash: await hashPassword(body.newPassword), tokenVersion: { increment: 1 } },
    });
    await startSession(reply, updated.id, updated.tokenVersion);
    return { ok: true, data: {} };
  });
}
