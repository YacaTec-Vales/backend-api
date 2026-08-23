import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { and, eq, isNull, asc } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../database/drizzle.provider';
import { categories, distributors } from '../database/schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryResponseDto } from './dto/category-response.dto';

/**
 * Servicio de categorias.
 *
 * Maneja la logica de negocio para las categorias de las distribuidoras.
 *
 * @author Equipo Mis Vales
 * @since 2.1.0
 */
@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Obtiene todas las categorias activas (no eliminadas).
   */
  async findAll(): Promise<CategoryResponseDto[]> {
    const records = await this.readDb
      .select()
      .from(categories)
      .where(isNull(categories.deletedAt))
      .orderBy(asc(categories.sortOrder));

    return records;
  }

  /**
   * Obtiene una categoria por ID.
   */
  async findOne(id: string): Promise<CategoryResponseDto> {
    const [record] = await this.readDb
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)));

    if (!record) {
      throw new NotFoundException({
        code: 'CATEGORIES.NOT_FOUND',
        message: 'la categoria no existe o fue eliminada',
      });
    }

    return record;
  }

  /**
   * Obtiene la categoria asignada a la distribuidora del usuario.
   */
  async findMine(userId: string): Promise<CategoryResponseDto> {
    const [dist] = await this.readDb
      .select({ categoryId: distributors.categoryId })
      .from(distributors)
      .where(
        and(eq(distributors.userId, userId), isNull(distributors.deletedAt)),
      );

    if (!dist) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el usuario no tiene una distribuidora asignada',
      });
    }

    return this.findOne(dist.categoryId);
  }

  /**
   * Crea una nueva categoria.
   */
  async create(dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    const [existing] = await this.readDb
      .select()
      .from(categories)
      .where(and(eq(categories.name, dto.name), isNull(categories.deletedAt)));

    if (existing) {
      throw new ConflictException({
        code: 'CATEGORIES.NAME_ALREADY_EXISTS',
        message: 'ya existe una categoria activa con ese nombre',
      });
    }

    const [created] = await this.writeDb
      .insert(categories)
      .values({
        name: dto.name,
        commissionBps: dto.commissionBps,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning();

    return created;
  }

  /**
   * Actualiza una categoria existente.
   */
  async update(
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.findOne(id);

    if (dto.name && dto.name !== category.name) {
      const [existing] = await this.readDb
        .select()
        .from(categories)
        .where(
          and(eq(categories.name, dto.name), isNull(categories.deletedAt)),
        );

      if (existing) {
        throw new ConflictException({
          code: 'CATEGORIES.NAME_ALREADY_EXISTS',
          message: 'ya existe una categoria activa con ese nombre',
        });
      }
    }

    const [updated] = await this.writeDb
      .update(categories)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(categories.id, id))
      .returning();

    return updated;
  }

  /**
   * Elimina una categoria (soft delete), validando que no haya distribuidoras asignadas.
   */
  async softDelete(id: string): Promise<void> {
    await this.findOne(id);

    const [activeDistributor] = await this.readDb
      .select({ id: distributors.id })
      .from(distributors)
      .where(
        and(
          eq(distributors.categoryId, id),
          isNull(distributors.deletedAt),
          eq(distributors.isActive, true),
        ),
      )
      .limit(1);

    if (activeDistributor) {
      throw new ConflictException({
        code: 'CATEGORIES.IN_USE',
        message:
          'no se puede eliminar la categoria porque existen distribuidoras activas asignadas a ella',
      });
    }

    await this.writeDb
      .update(categories)
      .set({
        deletedAt: new Date(),
        isActive: false,
      })
      .where(eq(categories.id, id));
  }
}
