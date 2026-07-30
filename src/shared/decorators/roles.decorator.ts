import { SetMetadata } from '@nestjs/common';
import type { UserType } from '../types/auth.types';

export const ROLES_KEY = 'auth:roles';
export const Roles = (...roles: UserType[]) => SetMetadata(ROLES_KEY, roles);
