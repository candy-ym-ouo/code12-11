declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      email: string;
      role: string;
    }

    interface Request {
      user?: AuthUser;
      validated: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
      traceId?: string;
    }
  }
}

export {};
