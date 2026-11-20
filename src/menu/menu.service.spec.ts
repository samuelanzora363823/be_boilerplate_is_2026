import { MenuService } from './menu.service.js';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('H1. Actualización de platillos', () => {
  const repo = { findByName: vi.fn(), create: vi.fn(), findById: vi.fn(), update: vi.fn() };
  const service = new MenuService(repo as never);
  beforeEach(() => vi.resetAllMocks());
  it('AC1: crea un platillo y devuelve los datos para actualizar el catálogo', async () => {
    repo.findByName.mockResolvedValue(null);
    repo.create.mockImplementation(async (x) => x);
    const data = { name: 'Ensalada', description: 'Fresca', price: '4.50', categoryId: 'cat', tags: ['Vegetariano'] };
    await expect(service.create(data)).resolves.toEqual(data);
    expect(repo.create).toHaveBeenCalledOnce();
  });
  it('AC2: reactiva un platillo agotado', async () => {
    repo.findById.mockResolvedValue({ id: 'dish', status: 'OUT_OF_STOCK' });
    await service.reactivate('dish');
    expect(repo.update).toHaveBeenCalledWith('dish', { status: 'ACTIVE' });
  });
  it('AC3: rechaza un nombre duplicado', async () => {
    repo.findByName.mockResolvedValue({ id: 'other' });
    await expect(service.create({ name: 'Repetido', price: '2.00', categoryId: 'cat', tags: [] })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('H2. Consulta del menú vigente', () => {
  const repo = { findBranch: vi.fn(), findActiveByBranch: vi.fn() };
  const service = new MenuService(repo as never);
  beforeEach(() => vi.resetAllMocks());
  it('AC1: devuelve los platillos agrupables por categoría', async () => {
    repo.findBranch.mockResolvedValue({ id: 'b' });
    repo.findActiveByBranch.mockResolvedValue([{ name: 'Sopa', category: { name: 'Entradas' } }]);
    await expect(service.findBranchMenu('b')).resolves.toEqual([{ name: 'Sopa', category: { name: 'Entradas' } }]);
  });
  it('AC3: solo consulta el menú vigente de la sucursal indicada', async () => {
    repo.findBranch.mockResolvedValue({ id: 'b' });
    repo.findActiveByBranch.mockResolvedValue([]);
    await service.findBranchMenu('b');
    expect(repo.findActiveByBranch).toHaveBeenCalledWith('b');
  });
  it('rechaza sucursal inexistente', async () => {
    repo.findBranch.mockResolvedValue(null);
    await expect(service.findBranchMenu('inexistente')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('H3. Filtrado de menú por categorías y dietas', () => {
  const repo = { findBranch: vi.fn(), findFilteredByBranch: vi.fn(), findCategories: vi.fn() };
  const service = new MenuService(repo as never);
  beforeEach(() => { vi.resetAllMocks(); repo.findBranch.mockResolvedValue({ id: 'b' }); });
  it('AC1: devuelve la lista filtrada para actualizar la pantalla', async () => {
    repo.findFilteredByBranch.mockResolvedValue([{ name: 'Sopa' }]);
    await expect(service.filterBranchMenu('b', undefined, 'Vegetariano')).resolves.toEqual([{ name: 'Sopa' }]);
  });
  it('AC2: expone categorías aunque no tengan platillos activos', async () => {
    repo.findCategories.mockResolvedValue([{ id: 'c' }]);
    await expect(service.findCategories()).resolves.toEqual([{ id: 'c' }]);
  });
  it('AC3: pasa los parámetros validados al repositorio', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await service.filterBranchMenu('b', id, 'Sin gluten');
    expect(repo.findFilteredByBranch).toHaveBeenCalledWith('b', [id], ['Sin gluten']);
  });
  it('rechaza etiquetas no permitidas', async () => {
    await expect(service.filterBranchMenu('b', undefined, 'NoExiste')).rejects.toBeInstanceOf(BadRequestException);
  });
});
