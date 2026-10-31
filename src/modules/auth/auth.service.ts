import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { HttpError } from '../../shared/http-error.js';
import type { AuthRepository } from './auth.repository.js';
import type { AuthResult, TokenPayload, User } from './auth.types.js';

const TOKEN_EXPIRES_IN = '24h';
const DEFAULT_SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
// bcrypt ignora todo lo que pase de 72 bytes: mejor rechazarlo que truncarlo en silencio.
const MAX_PASSWORD_BYTES = 72;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createAuthService(
  repository: AuthRepository,
  options: { jwtSecret: string; saltRounds?: number },
): AuthService {
  const { jwtSecret, saltRounds = DEFAULT_SALT_ROUNDS } = options;
  if (!jwtSecret) {
    throw new Error('jwtSecret es obligatorio');
  }

  // Hash de relleno para que un email inexistente tarde lo mismo que un password incorrecto.
  const dummyHash = bcrypt.hashSync('dummy-password', saltRounds);

  function signToken(user: User): string {
    const payload: TokenPayload = { sub: String(user.id), email: user.email };
    return jwt.sign(payload, jwtSecret, { expiresIn: TOKEN_EXPIRES_IN });
  }

  return {
    async register({ email, password, name }) {
      const normalizedEmail = normalizeEmail(email);
      const trimmedName = name.trim();
      validateRegistration(normalizedEmail, password, trimmedName);

      const passwordHash = await bcrypt.hash(password, saltRounds);
      const user = repository.insert(normalizedEmail, passwordHash, trimmedName);
      if (!user) {
        throw new HttpError(409, 'Ya existe un usuario con ese email', 'EMAIL_ALREADY_EXISTS');
      }

      return { token: signToken(user), user };
    },

    async login({ email, password }) {
      const found = repository.findByEmail(normalizeEmail(email));
      const valid = await bcrypt.compare(password, found?.passwordHash ?? dummyHash);

      // Mismo error en ambos casos: no revela qué emails están registrados.
      if (!found || !valid) {
        throw new HttpError(401, 'Email o password incorrectos', 'INVALID_CREDENTIALS');
      }

      const { passwordHash: _, ...user } = found;
      return { token: signToken(user), user };
    },
  };
}

function validateRegistration(email: string, password: string, name: string): void {
  if (!EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, 'El email no es válido', 'INVALID_EMAIL');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(
      400,
      `El password debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
      'PASSWORD_TOO_SHORT',
    );
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new HttpError(
      400,
      `El password no puede superar los ${MAX_PASSWORD_BYTES} bytes`,
      'PASSWORD_TOO_LONG',
    );
  }
  if (name.length === 0) {
    throw new HttpError(400, 'El nombre es obligatorio', 'INVALID_NAME');
  }
}
