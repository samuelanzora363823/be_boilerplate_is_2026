import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/services/prisma.service.js';
import { CreateMovementDto, ListInventoryQueryDto } from './dto.js';
import type { User } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { InventoryAlertStatus, MovementType, NotificationSource, Prisma, UserRole } from '../generated/prisma/client.js';

// Minúsculas y sin acentos, igual que Supply.searchName.
const normalize = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  constructor(private readonly db: PrismaService, private readonly notifications: NotificationsService) {}

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
  // H15 - CONSULTA DE EXISTENCIAS (también la usa el formulario de H14)
  // ==========================================

  async list(user: User, query: ListInventoryQueryDto) {
    const branch = await this.branchOf(user);
    const branchId = branch.id;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = normalize(query.search?.trim() ?? '');

    // "Por agotarse": existencias menores o iguales al stock mínimo.
    const lowStock: Prisma.BranchInventoryWhereInput = {
      quantity: { lte: this.db.branchInventory.fields.minimumStock },
    };

    const where: Prisma.BranchInventoryWhereInput = {
      branchId,
      ...(search ? { supply: { searchName: { contains: search } } } : {}),
      ...(query.lowStock === 'true' ? lowStock : {}),
    };

    const [rows, total, lowStockCount] = await this.db.$transaction([
      this.db.branchInventory.findMany({
        where,
        include: { supply: true },
        orderBy: { supply: { name: 'asc' } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.branchInventory.count({ where }),
      this.db.branchInventory.count({ where: { branchId, ...lowStock } }),
    ]);

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
      total,
      page,
      limit,
      lowStockCount,
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

    const outcome = await this.db.$transaction(async (tx) => {
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

      // El ciclo solo se rearma cuando la cantidad supera el mínimo.
      // Una alerta ATENDIDA continúa bloqueando duplicados mientras siga bajo.
      let alertId: string | null = null;
      if (result.quantity.gt(result.minimumStock)) {
        await tx.inventoryAlert.updateMany({
          where: { branchId, supplyId: inventory.supplyId, cycleOpen: true },
          data: { cycleOpen: false },
        });
      } else {
        const existing = await tx.inventoryAlert.findFirst({
          where: { branchId, supplyId: inventory.supplyId, cycleOpen: true },
          select: { id: true },
        });
        if (!existing) {
          const alert = await tx.inventoryAlert.create({
            data: {
              branchId, supplyId: inventory.supplyId,
              quantityAtAlert: result.quantity,
            },
          });
          alertId = alert.id;
        }
      }

      return { alertId, movement: {
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
      }};
    });

    // La notificación se envía después de confirmar la transacción del movimiento.
    // Un fallo de avisos no revierte un movimiento ya registrado.
    if (outcome.alertId) {
      try {
        const managers = await this.db.user.findMany({
          where: { role: UserRole.GERENTE, isActive: true, staffBranches: { some: { branchId } } },
          select: { id: true },
        });
        // H25 limita cada envío a 50 destinatarios.
        for (let i = 0; i < managers.length; i += 50) {
          await this.notifications.send({
            recipientIds: managers.slice(i, i + 50).map((manager) => manager.id),
            title: 'Insumo por agotarse',
            message: `${inventory.supply.name}: ${Number(outcome.movement.resultingQuantity)} ${inventory.supply.unit} disponibles (mínimo ${Number(outcome.movement.minimumStock)}).`,
            sourceModule: NotificationSource.INVENTARIO,
            referenceType: 'InventoryAlert',
            referenceId: outcome.alertId,
          });
        }
      } catch (error) {
        this.logger.error(`No se pudo notificar la alerta ${outcome.alertId}`, error instanceof Error ? error.stack : String(error));
      }
    }
    return outcome.movement;
  }

  async listAlerts(user: User) {
    const branchId = await this.branch(user);
    const rows = await this.db.inventoryAlert.findMany({
      where: { branchId }, include: { supply: true },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return rows.map((alert) => ({
      id: alert.id, supplyId: alert.supplyId, supplyName: alert.supply.name,
      unit: alert.supply.unit, quantityAtAlert: Number(alert.quantityAtAlert),
      status: alert.status, createdAt: alert.createdAt,
    }));
  }

  async attendAlert(user: User, id: string, status: string) {
    if (status !== 'Atendida') {
      throw new BadRequestException('El estado solicitado debe ser Atendida');
    }
    const branchId = await this.branch(user);
    const updated = await this.db.inventoryAlert.updateMany({
      where: { id, branchId, status: InventoryAlertStatus.ACTIVA },
      data: { status: InventoryAlertStatus.ATENDIDA },
    });
    if (!updated.count) {
      const alert = await this.db.inventoryAlert.findFirst({ where: { id, branchId } });
      if (!alert) throw new NotFoundException('La alerta no existe en tu sucursal');
      throw new ConflictException('La alerta ya fue atendida');
    }
    return { id, status: 'Atendida' };
  }
}
