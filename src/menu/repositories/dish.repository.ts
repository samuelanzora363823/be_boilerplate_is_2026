import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/services/prisma.service.js';

@Injectable()
export class DishRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.dish.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findById(id: string) {
    return this.prisma.dish.findUnique({
      where: { id },
    });
  }

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

  async create(data: {
    name: string;
    description?: string;
    price: string;
    categoryId: string;
    tags: string[];
  }) {
    return this.prisma.dish.create({
      data,
    });
  }

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
