export interface User {
  id: number;
  email: string;
  name: string;
  createdAt: string;
}

export interface UserWithPassword extends User {
  passwordHash: string;
}

export interface AuthResult {
  token: string;
  user: User;
}

/** Lo que el middleware de auth adjunta a `req.user`. */
export interface AuthenticatedUser {
  id: number;
  email: string;
}

export interface TokenPayload {
  sub: string;
  email: string;
}
