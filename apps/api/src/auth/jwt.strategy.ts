import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface JwtPayload {
  sub: string;          // providerSub (id stabile dell'utente sul provider)
  provider: string;     // "google" | "ibmsso" | …
  email: string;
  name?: string;
  role: "USER" | "ADMIN" | "MANAGER";
  // Email del manager diretto (claim w3id `managerEmail`). Presente solo per
  // login w3id; persistito su User.managerEmail al provisioning.
  managerEmail?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const secret = config.get<string>("NEXTAUTH_SECRET");
    if (!secret) {
      throw new Error("NEXTAUTH_SECRET not set — required to verify tokens from BFF");
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ["HS256"],
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload.sub || !payload.provider || !payload.email) {
      throw new UnauthorizedException("malformed token");
    }
    return payload;
  }
}
