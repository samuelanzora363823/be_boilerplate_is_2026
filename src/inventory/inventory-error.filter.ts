import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

// Forma de error de las historias de inventario: { code, message, field }.
const codes: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
};

// Mensajes de validación de los DTO y el campo al que corresponden.
const fields: Array<[RegExp, string]> = [
  [/insumo/i, 'supplyId'],
  [/tipo/i, 'type'],
  [/cantidad/i, 'quantity'],
  [/motivo/i, 'reason'],
  [/^limit/i, 'limit'],
  [/^property (\w+)/i, '$1'],
];

function fieldOf(message: string): string | null {
  for (const [pattern, field] of fields) {
    const match = message.match(pattern);
    if (match) return field.startsWith('$') ? match[1] : field;
  }
  return null;
}

@Catch(HttpException)
export class InventoryErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const raw =
      typeof body === 'string'
        ? body
        : (body as { message?: string | string[] }).message ?? exception.message;
    // Con varios errores de validación se informa el primero.
    const message = Array.isArray(raw) ? raw[0] : raw;

    host.switchToHttp().getResponse<Response>().status(status).json({
      code: codes[status] ?? 'ERROR',
      message,
      field: status === HttpStatus.BAD_REQUEST ? fieldOf(message) : null,
    });
  }
}
