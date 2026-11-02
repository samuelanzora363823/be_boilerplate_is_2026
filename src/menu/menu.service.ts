
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
  constructor(private readonly dishRepository: DishRepository) {}

  async findAll() {
    return this.dishRepository.findAll();
  }

  async findOne(id: string) {
    const dish = await this.dishRepository.findById(id);

    if (!dish) {
      throw new NotFoundException('Platillo no encontrado');
    }

    return dish;
  }

  async create(data: CreateDishData) {
    const name = data.name?.trim();

    if (!name) {
      throw new BadRequestException('El nombre es obligatorio');
    }

    const existing = await this.dishRepository.findByName(name);

    if (existing) {
      throw new ConflictException('Ya existe un platillo con ese nombre');
    }

    return this.dishRepository.create({
      ...data,
      name,
    });
  }

  async update(id: string, data: UpdateDishData) {
    await this.findOne(id);

    if (data.name !== undefined) {
      const name = data.name.trim();

      if (!name) {
        throw new BadRequestException('El nombre es obligatorio');
      }

      const existing = await this.dishRepository.findByName(name);

      if (existing && existing.id !== id) {
        throw new ConflictException('Ya existe un platillo con ese nombre');
      }

      data = { ...data, name };
    }

    return this.dishRepository.update(id, data);
  }

  async disable(id: string) {
    await this.findOne(id);

    return this.dishRepository.update(id, {
      status: 'DISABLED',
    });
  }

  async reactivate(id: string) {
    await this.findOne(id);

    return this.dishRepository.update(id, {
      status: 'ACTIVE',
    });
  }
}
