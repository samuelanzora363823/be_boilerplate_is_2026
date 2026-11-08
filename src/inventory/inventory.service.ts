import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/services/prisma.service.js';
import { CreateMovementDto } from './dto.js';
import type { User } from '../generated/prisma/client.js';
import { MovementType, Prisma } from '../generated/prisma/client.js';

@Injectable()
export class InventoryService {
  constructor(private readonly db: PrismaService) {}

  // La sucursal sale de la sesión (StaffBranch), nunca del cuerpo de la petición.
  private async branch(user: User) {
    return (await this.branchOf(user)).id;
  }

  private async branchOf(user: User) {
    const assignments = await this.db.staffBranch.findMany({
      where: { userId: user.id },
      select: { branch: { select: { id: true, name: true } } },
    });

    if (assignments.length !== 1) {
      throw new ForbiddenException(
        'El gerente debe estar asignado a una sola sucursal',
      );
    }

    return assignments[0].branch;
  }

  // ==========================================
  // H14 - INSUMOS DE LA SUCURSAL (para el formulario)
  // ==========================================

  async list(user: User, limit: number) {
    const branch = await this.branchOf(user);
    const rows = await this.db.branchInventory.findMany({
      where: { branchId: branch.id },
      include: { supply: true },
      orderBy: { supply: { name: 'asc' } },
      take: limit,
    });

    return {
      data: rows.map((row) => ({
        branchInventoryId: row.id,
        supplyId: row.supplyId,
        name: row.supply.name,
        unit: row.supply.unit,
        quantity: Number(row.quantity),
        minimumStock: Number(row.minimumStock),
        lowStock: row.quantity.lte(row.minimumStock),
        updatedAt: row.updatedAt,
      })),
      // Sucursal de la sesión, para el estado global del frontend.
      branch,
    };
  }

  // ==========================================
  // H14 - REGISTRO DE ENTRADAS Y SALIDAS
  // ==========================================

  async createMovement(user: User, dto: CreateMovementDto) {
    const branchId = await this.branch(user);
    const quantity = new Prisma.Decimal(dto.quantity);
    const reason = dto.reason.trim();

    const inventory = await this.db.branchInventory.findUnique({
      where: { branchId_supplyId: { branchId, supplyId: dto.supplyId } },
      include: { supply: true },
    });

    if (!inventory) {
      throw new NotFoundException('El insumo no existe en tu sucursal');
    }

    return this.db.$transaction(async (tx) => {
      // La condición sobre quantity evita que dos salidas simultáneas
      // dejen existencias negativas: solo una de las dos actualiza la fila.
      const updated = await tx.branchInventory.updateMany({
        where: {
          id: inventory.id,
          ...(dto.type === MovementType.SALIDA
            ? { quantity: { gte: quantity } }
            : {}),
        },
        data: {
          quantity:
            dto.type === MovementType.ENTRADA
              ? { increment: quantity }
              : { decrement: quantity },
        },
      });

      if (updated.count === 0) {
        const current = await tx.branchInventory.findUniqueOrThrow({
          where: { id: inventory.id },
        });
        const unit =
          inventory.supply.unit === 'UNIDAD'
            ? 'unidades'
            : inventory.supply.unit.toLowerCase();
        throw new ConflictException(
          `No hay existencias suficientes de ${inventory.supply.name}. Disponible: ${Number(current.quantity)} ${unit}.`,
        );
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          branchInventoryId: inventory.id,
          type: dto.type,
          quantity,
          reason,
          createdById: user.id,
        },
      });

      const result = await tx.branchInventory.findUniqueOrThrow({
        where: { id: inventory.id },
      });

      return {
        id: movement.id,
        supplyId: inventory.supplyId,
        supplyName: inventory.supply.name,
        unit: inventory.supply.unit,
        type: movement.type,
        quantity: Number(movement.quantity),
        reason: movement.reason,
        resultingQuantity: Number(result.quantity),
        minimumStock: Number(result.minimumStock),
        // H16 (alerta de insumos por agotarse) se apoya en este valor.
        lowStock: result.quantity.lte(result.minimumStock),
        createdAt: movement.createdAt,
        createdById: movement.createdById,
      };
    });
  }
}
