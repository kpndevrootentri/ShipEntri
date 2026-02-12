import * as bcrypt from 'bcryptjs';
import * as jose from 'jose';
import { userRepository, type IUserRepository } from '@/repositories/user.repository';
import { UnauthorizedError, ConflictError, ValidationError } from '@/lib/errors';
import { getConfig } from '@/lib/config';
import type { RegisterDto, LoginDto } from '@/validators/auth.validator';

const SALT_ROUNDS = 10;

export interface AuthTokens {
  accessToken: string;
  expiresIn: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export interface AuthServiceConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
}

export class AuthService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly config: AuthServiceConfig
  ) {}

  /**
   * Registers a new user. Throws if email already exists.
   */
  async register(dto: RegisterDto): Promise<{ userId: string; tokens: AuthTokens }> {
    const existing = await this.userRepo.findByEmail(dto.email);
    if (existing) {
      throw new ConflictError('Email already registered');
    }
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.userRepo.create({ email: dto.email, passwordHash });
    const tokens = await this.issueTokens(user.id, user.email);
    return { userId: user.id, tokens };
  }

  /**
   * Authenticates user and returns tokens.
   */
  async login(dto: LoginDto): Promise<{ userId: string; tokens: AuthTokens }> {
    const user = await this.userRepo.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password');
    }
    const tokens = await this.issueTokens(user.id, user.email);
    return { userId: user.id, tokens };
  }

  /**
   * Verifies JWT and returns payload. Throws UnauthorizedError if invalid.
   */
  async verifyToken(token: string): Promise<JwtPayload> {
    if (!this.config.jwtSecret) {
      throw new ValidationError('JWT_SECRET not configured');
    }
    try {
      const { payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode(this.config.jwtSecret),
        { algorithms: ['HS256'] }
      );
      const sub = payload.sub as string;
      const email = payload.email as string;
      if (!sub || !email) {
        throw new UnauthorizedError('Invalid token payload');
      }
      return {
        sub,
        email,
        iat: (payload.iat as number) ?? 0,
        exp: (payload.exp as number) ?? 0,
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    if (!this.config.jwtSecret) {
      throw new ValidationError('JWT_SECRET not configured');
    }
    const token = await new jose.SignJWT({ sub: userId, email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.config.jwtExpiresIn)
      .sign(new TextEncoder().encode(this.config.jwtSecret));
    return { accessToken: token, expiresIn: this.config.jwtExpiresIn };
  }
}

export const authService = new AuthService(userRepository, {
  jwtSecret: getConfig().JWT_SECRET ?? '',
  jwtExpiresIn: getConfig().JWT_EXPIRES_IN,
});
