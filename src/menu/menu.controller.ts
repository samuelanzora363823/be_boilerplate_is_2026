
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { UserRole } from '@PrismaClient';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';

import { MenuService } from './menu.service.js';
import { CreateDishDto } from './dto/create-dish.dto.js';
import { UpdateDishDto } from './dto/update-dish.dto.js';

@Controller('menu')
export class MenuController {
  constructor(
    private readonly menuService: MenuService,
  ) {}

  // ==========================================
  // CONSULTAR TODOS LOS PLATILLOS
  // ==========================================

  @Get()
  findAll() {
    return this.menuService.findAll();
  }

  // H2: listado de sucursales públicas.
  @Public()
  @Get('branches')
  findBranches() {
    return this.menuService.findBranches();
  }

  // H3: filtros públicos, antes de la ruta dinámica :branchId.
  @Public()
  @Get('categories')
  findCategories() {
    return this.menuService.findCategories();
  }

  @Public()
  @Get(':branchId/filter')
  filterBranchMenu(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query('category') category: unknown,
    @Query('tags') tags: unknown,
  ) {
    return this.menuService.filterBranchMenu(branchId, category, tags);
  }

  // H2: menú vigente de una sucursal.
  @Public()
  @Get(':branchId')
  findBranchMenu(@Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.menuService.findBranchMenu(branchId);
  }

  // ==========================================
  // CONSULTAR UN PLATILLO POR ID
  // ==========================================

  @Get('dish/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.menuService.findOne(id);
  }

  // ==========================================
  // CREAR PLATILLO - SOLO GERENTE
  // ==========================================

  @Roles(UserRole.GERENTE)
  @Post()
  create(@Body() data: CreateDishDto) {
    return this.menuService.create(data);
  }

  // ==========================================
  // ACTUALIZAR PLATILLO - SOLO GERENTE
  // ==========================================

  @Roles(UserRole.GERENTE)
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateDishDto,
  ) {
    return this.menuService.update(id, data);
  }

  // ==========================================
  // DESHABILITAR PLATILLO - SOLO GERENTE
  // ==========================================

  @Roles(UserRole.GERENTE)
  @Patch(':id/disable')
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.menuService.disable(id);
  }

  // ==========================================
  // REACTIVAR PLATILLO - SOLO GERENTE
  // ==========================================

  @Roles(UserRole.GERENTE)
  @Patch(':id/reactivate')
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.menuService.reactivate(id);
  }
}
