import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import { createServer, type Server as HttpServer } from 'node:http';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/services/prisma.service.js';
import { UserRole } from '../generated/prisma/client.js';
/** Socket.io en un puerto dedicado; autenticación JWT y control de sucursal. */
@Injectable()
export class KitchenGateway implements OnModuleDestroy {
  private io?: Server;
  private http?: HttpServer;
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}
  async start() {
    if (this.io) return;
    const port = Number(process.env.KITCHEN_SOCKET_PORT ?? 3002);
    this.http = createServer();
    this.io = new Server(this.http, { cors: { origin: (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001').split(',') } });
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (typeof token !== 'string') return next(new Error('Token requerido'));
        const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user?.isActive || user.role !== UserRole.COCINA) return next(new Error('Acceso denegado'));
        socket.data.userId = user.id;
        next();
      } catch { next(new Error('Token inválido')); }
    });
    this.io.on('connection', socket => {
      socket.on('join_kitchen', async (branchId: unknown, callback?: (result: { ok: boolean }) => void) => {
        const allowed = typeof branchId === 'string' && await this.prisma.staffBranch.findUnique({ where: { userId_branchId: { userId: socket.data.userId as string, branchId } } }).catch(() => null);
        if (allowed) await socket.join(`kitchen_${branchId}`);
        callback?.({ ok: Boolean(allowed) });
      });
    });
    await new Promise<void>((resolve, reject) => { this.http!.once('error', reject); this.http!.listen(port, '0.0.0.0', resolve); });
  }
  notify(branchId: string, order: unknown) { this.io?.to(`kitchen_${branchId}`).emit('new_order', order); }
  orderUpdated(branchId: string, order: unknown) { this.io?.to(`kitchen_${branchId}`).emit('order_updated', order); }
  orderCancelled(branchId: string, order: unknown) { this.io?.to(`kitchen_${branchId}`).emit('order_cancelled', order); }
  async onModuleDestroy() { await this.io?.close(); this.http?.close(); }
}
