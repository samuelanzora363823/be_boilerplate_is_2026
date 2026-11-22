import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MenuService } from './menu.service.js';
import { DishRepository } from './repositories/dish.repository.js';

describe('MenuService - H1, H2 y H3', () => {
  let service: MenuService;

  const repository = {
    findBranches: vi.fn(),
    findBranch: vi.fn(),
    findActiveByBranch: vi.fn(),
    findCategories: vi.fn(),
    findFilteredByBranch: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const dish = {
    id: 'dish-1',
    name: 'Hamburguesa',
    price: '5.50',
    status: 'ACTIVE',
  };

  const categoryId = '123e4567-e89b-42d3-a456-426614174000';

  beforeEach(() => {
    vi.resetAllMocks();
    service = new MenuService(repository as unknown as DishRepository);
  });

  describe('H1 - Gestión de platillos', () => {
    it('crea un platillo correctamente', async () => {
      repository.findByName.mockResolvedValue(null);
      repository.create.mockResolvedValue(dish);

      const result = await service.create({
        name: ' Hamburguesa ',
        price: '5.50',
        categoryId,
        tags: [],
      });

      expect(result).toEqual(dish);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Hamburguesa' }),
      );
    });

    it('rechaza un nombre vacío', async () => {
      await expect(
        service.create({
          name: ' ',
          price: '5.50',
          categoryId,
          tags: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un nombre duplicado', async () => {
      repository.findByName.mockResolvedValue(dish);

      await expect(
        service.create({
          name: 'Hamburguesa',
          price: '5.50',
          categoryId,
          tags: [],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('actualiza el precio de un platillo', async () => {
      repository.findById.mockResolvedValue(dish);
      repository.update.mockResolvedValue({ ...dish, price: '6.00' });

      const result = await service.update('dish-1', { price: '6.00' });

      expect(result.price).toBe('6.00');
      expect(repository.update).toHaveBeenCalledWith('dish-1', {
        price: '6.00',
      });
    });

    it('deshabilita un platillo', async () => {
      repository.findById.mockResolvedValue(dish);
      repository.update.mockResolvedValue({
        ...dish,
        status: 'DISABLED',
      });

      await service.disable('dish-1');

      expect(repository.update).toHaveBeenCalledWith('dish-1', {
        status: 'DISABLED',
      });
    });

    it('reactiva un platillo', async () => {
      repository.findById.mockResolvedValue(dish);
      repository.update.mockResolvedValue(dish);

      await service.reactivate('dish-1');

      expect(repository.update).toHaveBeenCalledWith('dish-1', {
        status: 'ACTIVE',
      });
    });

    it('rechaza la consulta de un platillo inexistente', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findOne('inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('H2 - Consulta de menú', () => {
    it('consulta las sucursales disponibles', async () => {
      const branches = [{ id: 'branch-1', name: 'Centro' }];
      repository.findBranches.mockResolvedValue(branches);

      expect(await service.findBranches()).toEqual(branches);
    });

    it('consulta el menú de una sucursal activa', async () => {
      repository.findBranch.mockResolvedValue({ id: 'branch-1' });
      repository.findActiveByBranch.mockResolvedValue([dish]);

      expect(await service.findBranchMenu('branch-1')).toEqual([dish]);
    });

    it('rechaza una sucursal inexistente o inactiva', async () => {
      repository.findBranch.mockResolvedValue(null);

      await expect(service.findBranchMenu('inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('H3 - Filtrado de menú', () => {
    beforeEach(() => {
      repository.findBranch.mockResolvedValue({ id: 'branch-1' });
      repository.findFilteredByBranch.mockResolvedValue([dish]);
    });

    it('filtra por categoría válida', async () => {
      await service.filterBranchMenu('branch-1', categoryId, undefined);

      expect(repository.findFilteredByBranch).toHaveBeenCalledWith(
        'branch-1',
        [categoryId],
        [],
      );
    });

    it('filtra por etiqueta dietética', async () => {
      await service.filterBranchMenu('branch-1', undefined, 'Vegetariano');

      expect(repository.findFilteredByBranch).toHaveBeenCalledWith(
        'branch-1',
        [],
        ['Vegetariano'],
      );
    });

    it('elimina filtros duplicados', async () => {
      await service.filterBranchMenu(
        'branch-1',
        undefined,
        'Vegetariano,Vegetariano',
      );

      expect(repository.findFilteredByBranch).toHaveBeenCalledWith(
        'branch-1',
        [],
        ['Vegetariano'],
      );
    });

    it('rechaza categorías con ID inválido', async () => {
      await expect(
        service.filterBranchMenu('branch-1', 'categoria-invalida', undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza etiquetas dietéticas no permitidas', async () => {
      await expect(
        service.filterBranchMenu('branch-1', undefined, 'Vegano'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza filtros vacíos', async () => {
      await expect(
        service.filterBranchMenu('branch-1', undefined, ' '),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
