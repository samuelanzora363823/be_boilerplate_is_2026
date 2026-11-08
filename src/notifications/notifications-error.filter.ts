import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

// Forma de error de la bandeja (H26): { code, message, field }.
const codes: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
};

const fields = ['status', 'sourceModule', 'page', 'limit'];

function fieldOf(message: string): string | null {
  const property = message.match(/^property (\w+)/i);
  if (property) return property[1];
  return fields.find((field) => message.startsWith(field)) ?? null;
}

@Catch(HttpException)
export class NotificationsErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const raw =
      typeof body === 'string'
        ? body
        : (body as { message?: string | string[] }).message ?? exception.message;
    const message = Array.isArray(raw) ? raw[0] : raw;

    host.switchToHttp().getResponse<Response>().status(status).json({
      code: codes[status] ?? 'ERROR',
      message,
      field: status === HttpStatus.BAD_REQUEST ? fieldOf(message) : null,
    });
  }
}
