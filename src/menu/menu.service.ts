
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { DishRepository } from './repositories/dish.repository.js';

type DishStatus = 'ACTIVE' | 'DISABLED' | 'OUT_OF_STOCK';

interface CreateDishData {
  name: string;
  description?: string;
  price: string;
  categoryId: string;
  tags: string[];
}

interface UpdateDishData {
  name?: string;
  description?: string;
  price?: string;
  categoryId?: string;
  tags?: string[];
  status?: DishStatus;
}

@Injectable()
export class MenuService {
  constructor(
    private readonly dishRepository: DishRepository,
  ) {}

  // ==========================================
  // H2 - CONSULTAR SUCURSALES ACTIVAS
  // ==========================================

  async findBranches() {
    return this.dishRepository.findBranches();
  }

  // ==========================================
  // H2 - CONSULTAR MENÚ POR SUCURSAL
  // ==========================================

  async findBranchMenu(branchId: string) {
    const branch = await this.dishRepository.findBranch(branchId);

    if (!branch) {
      throw new NotFoundException(
        'Sucursal no existe o está inactiva',
      );
    }

    return this.dishRepository.findActiveByBranch(branchId);
  }

  // ==========================================
  // H1 - CONSULTAR TODOS LOS PLATILLOS
  // ==========================================

  async findAll() {
    return this.dishRepository.findAll();
  }

  // ==========================================
  // H1 - CONSULTAR PLATILLO POR ID
  // ==========================================

  async findOne(id: string) {
    const dish = await this.dishRepository.findById(id);

    if (!dish) {
      throw new NotFoundException('Platillo no encontrado');
    }

    return dish;
  }

  // ==========================================
  // H1 - CREAR PLATILLO
  // ==========================================

  async create(data: CreateDishData) {
    const name = data.name?.trim();

    if (!name) {
      throw new BadRequestException(
        'El nombre es obligatorio',
      );
    }

    const existing = await this.dishRepository.findByName(name);

    if (existing) {
      throw new ConflictException(
        'Ya existe un platillo con ese nombre',
      );
    }

    return this.dishRepository.create({
      ...data,
      name,
    });
  }

  // ==========================================
  // H1 - ACTUALIZAR PLATILLO
  // ==========================================

  async update(id: string, data: UpdateDishData) {
    await this.findOne(id);

    if (data.name !== undefined) {
      const name = data.name.trim();

      if (!name) {
        throw new BadRequestException(
          'El nombre es obligatorio',
        );
      }

      const existing = await this.dishRepository.findByName(name);

      if (existing && existing.id !== id) {
        throw new ConflictException(
          'Ya existe un platillo con ese nombre',
        );
      }

      data = {
        ...data,
        name,
      };
    }

    return this.dishRepository.update(id, data);
  }

  // ==========================================
  // H1 - DESHABILITAR PLATILLO
  // ==========================================

  async disable(id: string) {
    await this.findOne(id);

    return this.dishRepository.update(id, {
      status: 'DISABLED',
    });
  }

  // ==========================================
  // H1 - REACTIVAR PLATILLO
  // ==========================================

  async reactivate(id: string) {
    await this.findOne(id);

    return this.dishRepository.update(id, {
      status: 'ACTIVE',
    });
  }
}
