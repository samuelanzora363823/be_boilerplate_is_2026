
import {
  Body,
  Controller,
  BadRequestException,
  Res,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import type { Response } from 'express';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

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

  // Las fotos se almacenan en un volumen persistente, nunca en la base de datos.
  @Roles(UserRole.GERENTE)
  @Post('dish/:id/image')
  async uploadDishImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: { data?: string; mimeType?: string },
  ) {
    await this.menuService.findOne(id);
    const allowed: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    };
    const ext = allowed[payload?.mimeType ?? ''];
    if (!ext || typeof payload?.data !== 'string' ||
        payload.data.length > 7_000_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.data)) {
      throw new BadRequestException('Imagen inválida (JPG, PNG o WebP; máximo 5 MB)');
    }
    const bytes = Buffer.from(payload.data, 'base64');
    const valid = bytes.length > 12 && bytes.length <= 5 * 1024 * 1024 && (
      (ext === 'jpg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      (ext === 'png' && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
      (ext === 'webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    );
    if (!valid) throw new BadRequestException('El contenido no corresponde a una imagen válida');
    const filename = `${randomUUID()}.${ext}`;
    const dir = process.env.DISH_UPLOAD_DIR || join(process.cwd(), 'uploads', 'dishes');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), bytes, { flag: 'wx' });
    const imageUrl = `/api/menu/images/${filename}`;
    await this.menuService.setDishImage(id, imageUrl);
    return { imageUrl };
  }

  @Public()
  @Get('images/:filename')
  async getDishImage(@Param('filename') filename: string, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(filename)) {
      return res.status(404).end();
    }
    const dir = process.env.DISH_UPLOAD_DIR || join(process.cwd(), 'uploads', 'dishes');
    try {
      const bytes = await readFile(join(dir, filename));
      const type = filename.endsWith('.png') ? 'image/png' : filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(bytes);
    } catch {
      return res.status(404).end();
    }
  }
  
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
