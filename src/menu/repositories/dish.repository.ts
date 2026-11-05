
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/services/prisma.service.js';

@Injectable()
export class DishRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // H2 - CONSULTAR SUCURSALES ACTIVAS
  // ==========================================

  async findBranches() {
    return this.prisma.branch.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  // ==========================================
  // H2 - CONSULTAR SUCURSAL
  // ==========================================

  async findBranch(id: string) {
    return this.prisma.branch.findFirst({
      where: {
        id,
        isActive: true,
      },
    });
  }

  // ==========================================
  // H2 - MENÚ VIGENTE POR SUCURSAL
  // ==========================================

  async findActiveByBranch(branchId: string) {
    const dishes = await this.prisma.dish.findMany({
      where: {
        status: 'ACTIVE',
        branchDishes: {
          some: {
            branchId,
            stockStatus: 'ACTIVE',
          },
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        tags: true,
        category: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    return dishes.map((dish) => ({
      id: dish.id,
      name: dish.name,
      description: dish.description,
      price: dish.price,
      tags: dish.tags,
      category: dish.category.name,
    }));
  }

  // ==========================================
  // H1 - CONSULTAR TODOS LOS PLATILLOS
  // ==========================================

  async findAll() {
    return this.prisma.dish.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // ==========================================
  // H1 - CONSULTAR PLATILLO POR ID
  // ==========================================

  async findById(id: string) {
    return this.prisma.dish.findUnique({
      where: { id },
    });
  }

  // ==========================================
  // H1 - BUSCAR PLATILLO POR NOMBRE
  // ==========================================

  async findByName(name: string) {
    return this.prisma.dish.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
      },
    });
  }

  // ==========================================
  // H1 - CREAR PLATILLO
  // ==========================================

  async create(data: {
    name: string;
    description?: string;
    price: string;
    categoryId: string;
    tags: string[];
  }) {
    const branches = await this.prisma.branch.findMany({
      select: {
        id: true,
      },
    });

    return this.prisma.dish.create({
      data: {
        ...data,
        branchDishes: {
          create: branches.map((branch) => ({
            branchId: branch.id,
          })),
        },
      },
    });
  }

  // ==========================================
  // H1 - ACTUALIZAR PLATILLO
  // ==========================================

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      price?: string;
      categoryId?: string;
      tags?: string[];
      status?: 'ACTIVE' | 'DISABLED' | 'OUT_OF_STOCK';
    },
  ) {
    return this.prisma.dish.update({
      where: { id },
      data,
    });
  }
}
