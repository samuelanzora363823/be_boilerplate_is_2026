
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

  // H3: las categorías se listan aunque no tengan platillos disponibles,
  // para que la interfaz pueda mostrarlas deshabilitadas.
  async findCategories() {
    return this.dishRepository.findCategories();
  }

  async filterBranchMenu(branchId: string, category: unknown, tags: unknown) {
    const branch = await this.dishRepository.findBranch(branchId);
    if (!branch) throw new NotFoundException('Sucursal no existe o está inactiva');

    const parse = (value: unknown): string[] => {
      if (value === undefined) return [];
      if (typeof value !== 'string' || !value.trim()) {
        throw new BadRequestException('Parámetros de filtro inválidos');
      }
      const values = value.split(',').map((v) => v.trim());
      if (values.some((v) => !v)) throw new BadRequestException('Filtros vacíos');
      return [...new Set(values)];
    };

    const categories = parse(category);
    const diets = parse(tags);
    if (categories.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
      throw new BadRequestException('ID de categoría inválido');
    }
    if (diets.some((diet) => !['Vegetariano', 'Sin gluten'].includes(diet))) {
      throw new BadRequestException('Etiqueta dietética inválida');
    }
    return this.dishRepository.findFilteredByBranch(branchId, categories, diets);
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

  async setDishImage(id: string, imageUrl: string) {
    await this.findOne(id);
    return this.dishRepository.update(id, { imageUrl });
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
