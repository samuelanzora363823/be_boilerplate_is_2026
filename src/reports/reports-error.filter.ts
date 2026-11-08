import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

// Forma de error de los reportes (Épica 10): { code, message, field }.
const codes: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
};

const fields = ['branchId', 'from', 'to'];

function fieldOf(message: string): string | null {
  const extra = /^(\w+) no es un parámetro permitido/.exec(message);
  if (extra) return extra[1];
  return fields.find((field) => message.startsWith(`${field} `)) ?? null;
}

@Catch(HttpException)
export class ReportsErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const status = exception.getStatus();
    const body = exception.getResponse() as
      | string
      | { message?: string | string[]; field?: string | null };
    const raw =
      typeof body === 'string' ? body : (body.message ?? exception.message);
    let message = Array.isArray(raw) ? raw[0] : raw;
    // Mensajes de la Épica 10 para los casos generales.
    if (status === HttpStatus.FORBIDDEN) {
      message = 'No tiene permiso para ver reportes.';
    }
    const extra = /^property (\w+) should not exist$/.exec(message);
    if (extra) message = `${extra[1]} no es un parámetro permitido.`;
    const field =
      typeof body === 'object' && body.field !== undefined
        ? body.field
        : status === HttpStatus.BAD_REQUEST
          ? fieldOf(message)
          : null;

    host.switchToHttp().getResponse<Response>().status(status).json({
      code: codes[status] ?? 'ERROR',
      message,
      field,
    });
  }
}
